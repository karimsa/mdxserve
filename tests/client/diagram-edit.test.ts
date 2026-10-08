// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { afterEach, expect, it } from "vitest";
import { findDiagram, replaceDiagram, mermaidEditButtons } from "../../client/diagrams/edit-block";
const original = "flowchart LR\n A --> B";
const replacement = "flowchart LR\n A --> C";
let editor: Editor;
afterEach(() => editor?.destroy());
function createEditor() {
	editor = new Editor({
		extensions: [StarterKit, Markdown],
		contentType: "markdown",
		content: `Before\n\n\`\`\`mermaid\n${original}\n\`\`\`\n\nBetween\n\n\`\`\`mermaid\n${original}\n\`\`\`\n\nAfter`,
	});
	return editor;
}
it("updates only the selected duplicate diagram and supports one-step undo", () => {
	createEditor();
	const before = editor.getMarkdown();
	const target = findDiagram(editor, { index: 1, source: original })!;
	expect(replaceDiagram(editor, target, replacement)).toBe(true);
	expect(findDiagram(editor, { index: 0, source: original })).not.toBeNull();
	expect(findDiagram(editor, { index: 1, source: replacement })).not.toBeNull();
	expect(editor.getMarkdown()).toContain("Between");
	expect(editor.getMarkdown()).toContain("After");
	expect(editor.commands.undo()).toBe(true);
	expect(editor.getMarkdown()).toBe(before);
});
it("refuses a stale diagram location or source without changing the document", () => {
	createEditor();
	const target = findDiagram(editor, { index: 1, source: original })!;
	expect(findDiagram(editor, { index: 1, source: replacement })).toBeNull();
	editor.commands.setContent("Changed document", { contentType: "markdown" });
	const before = editor.getMarkdown();
	expect(replaceDiagram(editor, target, replacement)).toBe(false);
	expect(editor.getMarkdown()).toBe(before);
});
it("exposes edit buttons in the section editor without adding them to serialized Markdown", () => {
	let clicked = "";
	editor = new Editor({
		extensions: [
			StarterKit,
			Markdown,
			mermaidEditButtons(
				() => true,
				(target) => {
					clicked = target.source;
				},
			),
		],
		contentType: "markdown",
		content: `\`\`\`mermaid\n${original}\n\`\`\``,
	});
	const button = editor.view.dom.querySelector<HTMLButtonElement>(
		'button[aria-label="Edit diagram"]',
	)!;
	const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
	expect(button.dispatchEvent(mouseDown)).toBe(false);
	button.click();
	expect(clicked).toBe(original);
	expect(editor.getMarkdown()).not.toContain("Edit diagram");
});
