// @vitest-environment jsdom
import { act, createElement, useContext } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "jotai";
import { expect, it, vi } from "vitest";
import { MdSection } from "../../client/MdSection";
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
		createElement("button", { onClick: () => edit?.({ index: 0, source }) }, "Edit"),
	);
}
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
