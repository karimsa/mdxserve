// @vitest-environment jsdom
import { act, createElement, useContext } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "jotai";
import { expect, it, vi } from "vitest";
import { createProcessor } from "@mdx-js/mdx";
import { mdxCompileOptions } from "../../src/rendering/mdx/mdx-options";
import { createMetadataPort } from "../helpers/metadata.js";
import { remarkSections } from "../../src/rendering/mdx/remark-sections";
import type { Root, RootContent } from "mdast";
import type { MdxJsxFlowElement } from "mdast-util-mdx";
import { Pre } from "../../client/CodeBlock";
import { MdSection, type MdSectionProps } from "../../client/MdSection";
import { DiagramEditContext } from "../../client/diagrams/edit-context";
const rpc = vi.hoisted(() => ({ save: vi.fn(), source: vi.fn() }));
vi.mock("../../client/api", () => ({
	trpcClient: {
		getDiagramPreferences: { query: async () => ({ agent: "codex" }) },
		getDocSource: { query: rpc.source },
		saveDocSection: { mutate: rpc.save },
	},
}));
vi.mock("../../client/MdSectionEditor", () => ({
	default: () => {
		throw new Error("Direct diagram editing must not mount Tiptap");
	},
}));
vi.mock("../../client/Mermaid", () => ({ MermaidDiagram: () => null }));
vi.mock("../../client/diagrams/Dialog", () => ({
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
const source = "flowchart LR\n A --> B";
function Diagram() {
	const edit = useContext(DiagramEditContext);
	return createElement(
		"div",
		null,
		"Rendered diagram",
		edit && createElement("button", { onClick: () => edit({ index: 0, source }) }, "Edit"),
	);
}
it("hides direct editing inside JSX while the following blockquote diagram still opens", async () => {
	vi.stubGlobal("matchMedia", () => ({
		matches: true,
		addEventListener() {},
		removeEventListener() {},
	}));
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	const nestedSource = "flowchart LR\n N --> X";
	const markdown = [
		"<Callout>",
		"```mermaid",
		nestedSource,
		"```",
		"</Callout>",
		"",
		"> ```mermaid",
		"> flowchart LR",
		">  A --> B",
		"> ```",
	].join("\n");
	const tree = createProcessor({ ...mdxCompileOptions(createMetadataPort()), format: "mdx" }).parse(
		markdown,
	) as Root;
	remarkSections()(tree);
	const sections = tree.children.filter(
		(node: RootContent): node is MdxJsxFlowElement =>
			node.type === "mdxJsxFlowElement" && node.name === "MdSection",
	);
	const props = (section: MdxJsxFlowElement) =>
		Object.fromEntries(
			section.attributes
				.filter((attribute) => attribute.type === "mdxJsxAttribute")
				.map((attribute) => [attribute.name, attribute.value]),
		) as unknown as Pick<MdSectionProps, "index" | "startLine" | "endLine" | "rawJsx">;
	expect(sections).toHaveLength(2);
	expect(props(sections[0]).rawJsx).toBe("true");
	expect(props(sections[1]).rawJsx).toBeUndefined();
	rpc.source.mockResolvedValue({ text: markdown, version: "original-version" });
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () =>
			root.render(
				createElement(
					Provider,
					null,
					createElement(
						"div",
						null,
						createElement(MdSection, {
							...props(sections[0]),
							// oxlint-disable-next-line react/no-children-prop
							children: createElement(Pre, { "data-language": "mermaid" }, nestedSource),
						}),
						createElement(MdSection, {
							...props(sections[1]),
							// oxlint-disable-next-line react/no-children-prop
							children: createElement(Pre, { "data-language": "mermaid" }, source),
						}),
					),
				),
			),
		);
		const editButtons = host.querySelectorAll<HTMLButtonElement>(
			'button[aria-label="Edit diagram"]',
		);
		expect(editButtons).toHaveLength(1);
		expect(editButtons[0].closest("[data-md-section]")?.getAttribute("data-md-section")).toBe("1");
		await act(async () => editButtons[0].click());
		await vi.waitFor(async () => {
			await act(async () => {});
			expect(host.querySelector("dialog")).not.toBeNull();
		});
		expect(host.querySelector("dialog")?.textContent).toContain(source);
		expect(host.querySelector("dialog")?.textContent).not.toContain("Diagram changed on disk");
	} finally {
		await act(async () => root.unmount());
		host.remove();
		vi.unstubAllGlobals();
	}
});
it.each(["save", "cancel", "failure"])(
	"edits from the rendered page without Tiptap: %s",
	async (action) => {
		rpc.source.mockResolvedValue({
			text: `Before\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nAfter`,
			version: "original-version",
		});
		rpc.save.mockReset();
		if (action === "failure") rpc.save.mockRejectedValue(new Error("offline"));
		else rpc.save.mockResolvedValue({ version: "saved-version" });
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () =>
				root.render(
					createElement(
						Provider,
						null,
						createElement(MdSection, {
							index: "0",
							startLine: "3",
							endLine: "6",
							// Required by MdSectionProps when using createElement in this .ts test.
							// oxlint-disable-next-line react/no-children-prop
							children: createElement(Diagram),
						}),
					),
				),
			);
			const button = [...host.querySelectorAll("button")].find(
				(button) => button.textContent === "Edit",
			)!;
			await act(async () => button.click());
			await vi.waitFor(async () => {
				await act(async () => {});
				expect(host.querySelector("dialog")).not.toBeNull();
			});
			expect(host.textContent).toContain("Rendered diagram");
			expect(host.querySelector('[contenteditable="true"]')).toBeNull();
			const actionButton = [...host.querySelectorAll("dialog button")].find(
				(button) => button.textContent === (action === "cancel" ? "Cancel" : "Save diagram"),
			) as HTMLButtonElement;
			await act(async () => actionButton.click());
			if (action === "cancel") expect(rpc.save).not.toHaveBeenCalled();
			else
				expect(rpc.save).toHaveBeenCalledWith(
					expect.objectContaining({
						version: "original-version",
						startLine: 3,
						endLine: 6,
						markdown: "```mermaid\nflowchart LR\n A --> C\n```",
					}),
				);
			if (action === "failure") {
				expect(host.querySelector("dialog")).not.toBeNull();
				expect(host.textContent).toContain("Your changes are still here");
			} else expect(host.querySelector("dialog")).toBeNull();
		} finally {
			await act(async () => root.unmount());
			host.remove();
		}
	},
);
