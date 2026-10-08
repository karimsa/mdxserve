// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import MdSectionEditor from "../../client/MdSectionEditor";
vi.mock("../../client/api", () => ({
	trpcClient: { getDiagramPreferences: { query: async () => ({ agent: "codex" }) } },
}));
it("allows section cancellation after Tiptap handles Escape to select a parent node", async () => {
	// jsdom has no layout; Tiptap's focus scroll requires these browser geometry APIs.
	Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect = () => new DOMRect();
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const done = vi.fn();
	try {
		await act(async () =>
			root.render(
				createElement(MdSectionEditor, {
					source: "```mermaid\nflowchart LR\n A --> B\n```",
					version: "version",
					path: "/example.md",
					startLine: 1,
					endLine: 4,
					onDone: done,
				}),
			),
		);
		expect(host.querySelector('button[aria-label="Edit diagram"]')).not.toBeNull();
		const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
		// ProseMirror handles Escape's node selection before React receives the event.
		event.preventDefault();
		await act(async () =>
			host.querySelector('[aria-label="Section editor"]')!.dispatchEvent(event),
		);
		expect(done).toHaveBeenCalledOnce();
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});
