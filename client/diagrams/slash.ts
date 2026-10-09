import { Extension, type Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";

export function mermaidSlash(enabled: () => boolean, onOpen: (range: Range) => void) {
	return Extension.create({
		name: "mermaidSlash",
		addProseMirrorPlugins() {
			return [
				Suggestion({
					editor: this.editor,
					pluginKey: new PluginKey("mermaidSlash"),
					char: "/",
					startOfLine: true,
					allow: ({ editor, state, range }) =>
						enabled() &&
						editor.isEditable &&
						state.selection.empty &&
						!state.selection.$from.marks().some((mark) => mark.type.name === "code") &&
						state.doc.resolve(range.from).parent.type.name === "paragraph" &&
						state.doc.resolve(range.from).parent.textContent ===
							state.doc.textBetween(range.from, range.to),
					items: ({ query }) =>
						["mermaid", "diagram", "er", "image"].some((term) =>
							term.startsWith(query.toLowerCase()),
						)
							? ["mermaid"]
							: [],
					command: ({ range }) => onOpen(range),
					render: () => {
						let menu: HTMLDivElement | undefined;
						let choose: (() => void) | undefined;
						return {
							onStart(props) {
								menu = document.createElement("div");
								menu.className = "diagram-slash-menu";
								menu.hidden = props.items.length === 0;
								menu.setAttribute("role", "listbox");
								menu.setAttribute("aria-label", "Insert block");
								const button = document.createElement("button");
								button.type = "button";
								button.setAttribute("role", "option");
								button.setAttribute("aria-selected", "true");
								button.textContent = "Mermaid diagram";
								button.onmousedown = (event) => {
									event.preventDefault();
									choose?.();
									menu?.remove();
									menu = undefined;
								};
								menu.append(button);
								document.body.append(menu);
								choose = () => props.command("mermaid");
								const rect = props.clientRect?.();
								if (rect) {
									menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 260))}px`;
									menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 70)}px`;
								}
							},
							onUpdate(props) {
								choose = () => props.command("mermaid");
								if (menu) menu.hidden = props.items.length === 0;
							},
							onKeyDown({ event }) {
								if (event.key === "Escape") {
									menu?.remove();
									menu = undefined;
									event.preventDefault();
									event.stopPropagation();
									return true;
								}
								if (menu && !menu.hidden && ["Enter", "ArrowDown", "ArrowUp"].includes(event.key)) {
									event.preventDefault();
									event.stopPropagation();
									if (event.key === "Enter") {
										choose?.();
										menu.remove();
										menu = undefined;
									}
									return true;
								}
								return false;
							},
							onExit() {
								menu?.remove();
								menu = undefined;
							},
						};
					},
				}),
			];
		},
	});
}
