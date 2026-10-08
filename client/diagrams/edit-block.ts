import { comparableSource } from "./source";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import type { ExistingDiagram } from "./edit-context";
export type DiagramEditTarget = { range: Range; source: string };
export function findDiagram(editor: Editor, target: ExistingDiagram): DiagramEditTarget | null {
	let index = 0;
	let found: DiagramEditTarget | null = null;
	editor.state.doc.descendants((node, position) => {
		if (node.type.name !== "codeBlock" || node.attrs.language !== "mermaid") return;
		if (
			index++ === target.index &&
			comparableSource(node.textContent) === comparableSource(target.source)
		)
			found = { range: { from: position, to: position + node.nodeSize }, source: node.textContent };
	});
	return found;
}
/** Replace exactly the captured block, preserving its attributes and an independent undo step. */
export function replaceDiagram(editor: Editor, target: DiagramEditTarget, source: string): boolean {
	if (target.range.from < 0 || target.range.from >= editor.state.doc.content.size) return false;
	const node = editor.state.doc.nodeAt(target.range.from);
	if (
		!node ||
		node.type.name !== "codeBlock" ||
		node.attrs.language !== "mermaid" ||
		node.textContent !== target.source ||
		target.range.to !== target.range.from + node.nodeSize
	)
		return false;
	editor.view.dispatch(closeHistory(editor.state.tr));
	const replaced = editor.commands.insertContentAt(target.range, {
		type: "codeBlock",
		attrs: node.attrs,
		content: source ? [{ type: "text", text: source }] : [],
	});
	editor.view.dispatch(closeHistory(editor.state.tr));
	return replaced;
}
/** Keep the same edit action available while the section is already in Tiptap. */
export function mermaidEditButtons(
	enabled: () => boolean,
	onEdit: (target: DiagramEditTarget) => void,
) {
	return Extension.create({
		name: "mermaidEditButtons",
		addProseMirrorPlugins() {
			return [
				new Plugin({
					props: {
						decorations(state) {
							if (!enabled()) return DecorationSet.empty;
							const decorations: Decoration[] = [];
							state.doc.descendants((node, position) => {
								if (node.type.name !== "codeBlock" || node.attrs.language !== "mermaid") return;
								decorations.push(
									Decoration.widget(
										position,
										() => {
											const button = document.createElement("button");
											button.type = "button";
											button.className = "diagram-edit-block";
											button.textContent = "Edit diagram";
											button.setAttribute("aria-label", "Edit diagram");
											// Keep ProseMirror from moving the selection and replacing this widget before click.
											button.onmousedown = (event) => {
												event.preventDefault();
												event.stopPropagation();
											};
											button.onclick = (event) => {
												event.preventDefault();
												event.stopPropagation();
												onEdit({
													range: { from: position, to: position + node.nodeSize },
													source: node.textContent,
												});
											};
											return button;
										},
										{ side: -1 },
									),
								);
							});
							return DecorationSet.create(state.doc, decorations);
						},
					},
				}),
			];
		},
	});
}
