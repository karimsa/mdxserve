// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { DocContext } from "../src/DocContext";
import { NodeList } from "../src/document/nodes";
import { DocumentService } from "@karimsa/mdxserve/src/document/service";
import { fixtureRegistry } from "@karimsa/mdxserve/tests/fixtures/registry";

const rpc = vi.hoisted(() => ({ save: vi.fn(), source: vi.fn(), invalidate: vi.fn() }));
vi.mock("../src/api", () => ({
	trpcClient: {
		getDiagramPreferences: { query: async () => ({ agent: "codex" }) },
		getNodeSource: { query: rpc.source },
		saveDocNode: { mutate: rpc.save },
	},
	trpc: {
		getDocument: { queryFilter: (input: unknown) => ({ queryKey: ["getDocument", input] }) },
	},
	queryClient: { invalidateQueries: rpc.invalidate },
}));
vi.mock("../src/MdSectionEditor", () => ({
	default: () => {
		throw new Error("Direct diagram editing must not mount Tiptap");
	},
}));
vi.mock("../src/Mermaid", () => ({ MermaidDiagram: () => null }));
vi.mock("../src/diagrams/Dialog", () => ({
	MermaidDialog: ({
		initialSource,
		onInsert,
		onClose,
		saveError,
		directSave,
	}: {
		initialSource: string;
		onInsert: (source: string) => void;
		onClose: () => void;
		saveError: string;
		directSave: boolean;
	}) =>
		createElement(
			"dialog",
			{ open: true },
			initialSource,
			createElement(
				"button",
				{ onClick: () => onInsert("flowchart LR\n A --> C") },
				directSave ? "Save diagram" : "Update in draft",
			),
			createElement("button", { onClick: onClose }, "Cancel"),
			createElement("span", { role: "alert" }, saveError),
		),
}));

const PATH = "/docs/diagrams.md";
const source = "flowchart LR\n A --> B";
const nestedSource = "flowchart LR\n N --> X";
const markdown = [
	"## Flow",
	"",
	"Before",
	"",
	"```mermaid",
	source,
	"```",
	"",
	"<Callout>",
	"```mermaid",
	nestedSource,
	"```",
	"</Callout>",
	"",
	"After",
].join("\n");

// Load the lazy edit dialog up front, so its chunk does not finish loading
// between two act() calls.
beforeAll(async () => {
	await import("../src/diagrams/EditDialog");
});
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("matchMedia", () => ({
		matches: true,
		addEventListener() {},
		removeEventListener() {},
	}));
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	rpc.save.mockReset();
	rpc.source.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

async function renderDocument() {
	const { tree } = new DocumentService(fixtureRegistry, (relative) => relative).parse(
		markdown,
		PATH,
	);
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () =>
		root.render(
			createElement(
				DocContext,
				{ value: { path: PATH } },
				createElement(NodeList, { nodes: tree.children }),
			),
		),
	);
	return {
		host,
		async cleanup() {
			await act(async () => root.unmount());
			host.remove();
		},
	};
}

function editButtons(host: HTMLElement) {
	return [...host.querySelectorAll<HTMLButtonElement>('button[aria-label="Edit diagram"]')];
}

async function openDialog(host: HTMLElement, button: HTMLButtonElement) {
	await act(async () => button.click());
	await vi.waitFor(async () => {
		await act(async () => {});
		expect(host.querySelector("dialog")).not.toBeNull();
	});
}

it("gives every mermaid block, nested ones included, an edit action addressed by its id", async () => {
	rpc.source.mockResolvedValue({
		markdown: "```mermaid\n" + nestedSource + "\n```",
		version: "original-version",
	});
	const mounted = await renderDocument();
	try {
		const buttons = editButtons(mounted.host);
		expect(buttons).toHaveLength(2);
		await openDialog(mounted.host, buttons[1]);
		expect(rpc.source).toHaveBeenCalledWith({ path: PATH, id: "flow>~mermaid-2" });
		expect(mounted.host.querySelector("dialog")?.textContent).toContain(nestedSource);
		expect(mounted.host.querySelector("dialog")?.textContent).not.toContain(
			"Diagram changed on disk",
		);
	} finally {
		await mounted.cleanup();
	}
});

it.each(["save", "cancel", "failure"])(
	"edits from the rendered page without Tiptap: %s",
	async (action) => {
		rpc.source.mockResolvedValue({
			markdown: "```mermaid\n" + source + "\n```",
			version: "original-version",
		});
		if (action === "failure") rpc.save.mockRejectedValue(new Error("offline"));
		else rpc.save.mockResolvedValue({ version: "saved-version" });
		const mounted = await renderDocument();
		try {
			await openDialog(mounted.host, editButtons(mounted.host)[0]);
			expect(rpc.source).toHaveBeenCalledWith({ path: PATH, id: "flow>~mermaid-1" });
			expect(mounted.host.querySelector('[contenteditable="true"]')).toBeNull();
			const actionButton = [...mounted.host.querySelectorAll("dialog button")].find(
				(button) => button.textContent === (action === "cancel" ? "Cancel" : "Save diagram"),
			) as HTMLButtonElement;
			await act(async () => actionButton.click());
			if (action === "cancel") expect(rpc.save).not.toHaveBeenCalled();
			else
				expect(rpc.save).toHaveBeenCalledWith({
					path: PATH,
					id: "flow>~mermaid-1",
					version: "original-version",
					markdown: "```mermaid\nflowchart LR\n A --> C\n```",
				});
			if (action === "failure") {
				expect(mounted.host.querySelector("dialog")).not.toBeNull();
				expect(mounted.host.textContent).toContain("Your changes are still here");
			} else expect(mounted.host.querySelector("dialog")).toBeNull();
		} finally {
			await mounted.cleanup();
		}
	},
);
