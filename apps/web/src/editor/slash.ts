import { Extension, type Range } from "@tiptap/core";
import { Suggestion, type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { insertSlashBlock, matchingBlocks, type SlashBlock } from "./blocks";

export function blockSlash(
	enabledDiagram: () => boolean,
	onOpenDiagram: (range: Range) => void,
	onOpenImage: (range: Range) => void,
	onOpenLink?: (range: Range) => void,
) {
	return Extension.create({
		name: "blockSlash",
		addProseMirrorPlugins() {
			const editor = this.editor;
			return [
				Suggestion<SlashBlock>({
					editor,
					pluginKey: new PluginKey("blockSlash"),
					char: "/",
					allowSpaces: true,
					startOfLine: true,
					allow: ({ editor: activeEditor, state, range }) =>
						activeEditor.isEditable &&
						state.selection.empty &&
						!state.selection.$from.marks().some((mark) => mark.type.name === "code") &&
						state.doc.resolve(range.from).parent.type.name === "paragraph" &&
						state.doc.resolve(range.from).parent.textContent ===
							state.doc.textBetween(range.from, range.to),
					items: ({ query }) => matchingBlocks(query),
					command: ({ range, props: block }) => {
						if (block.kind === "image") onOpenImage(range);
						else if (block.id === "link" && onOpenLink) onOpenLink(range);
						else if (block.kind === "diagram" && enabledDiagram()) onOpenDiagram(range);
						else insertSlashBlock(editor, range, block);
					},
					render: () => {
						let menu: HTMLDivElement | undefined;
						let activeProps: SuggestionProps<SlashBlock> | undefined;
						let selected = 0;
						let scrollTarget: Element | null = null;
						const position = () => {
							if (!menu || !activeProps) return;
							const rect = activeProps.clientRect?.();
							if (!rect) return;
							const margin = 8;
							const width = menu.getBoundingClientRect().width || 320;
							const height = menu.getBoundingClientRect().height;
							menu.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`;
							const below = window.innerHeight - rect.bottom - margin;
							const above = rect.top - margin;
							menu.style.top = `${below >= height || below >= above ? Math.min(rect.bottom + 6, window.innerHeight - height - margin) : Math.max(margin, rect.top - height - 6)}px`;
						};
						const destroy = () => {
							window.removeEventListener("resize", position);
							window.removeEventListener("scroll", position, true);
							scrollTarget?.removeEventListener("scroll", position);
							scrollTarget = null;
							menu?.remove();
							menu = undefined;
							activeProps = undefined;
						};
						const choose = (index: number) => {
							const block = activeProps?.items[index];
							if (!block || !activeProps) return;
							activeProps.command(block);
							destroy();
						};
						const draw = () => {
							if (!menu || !activeProps) return;
							menu.replaceChildren();
							const blocks = activeProps.items;
							if (selected >= blocks.length) selected = 0;
							menu.hidden = blocks.length === 0;
							if (blocks.length === 0) return;
							let group = "";
							blocks.forEach((block, index) => {
								if (group !== block.group) {
									group = block.group;
									const heading = document.createElement("div");
									heading.className = "block-slash-group";
									heading.textContent = group;
									menu?.append(heading);
								}
								const option = document.createElement("button");
								option.type = "button";
								option.className = "block-slash-option";
								option.id = `block-slash-${block.id}`;
								option.setAttribute("role", "option");
								option.setAttribute("aria-selected", String(index === selected));
								const title = document.createElement("strong");
								title.textContent = block.label;
								const description = document.createElement("small");
								description.textContent = block.description;
								option.append(title, description);
								option.onmouseenter = () => {
									selected = index;
									updateSelection();
								};
								option.onmousedown = (event) => {
									event.preventDefault();
									choose(index);
								};
								menu?.append(option);
							});
							position();
						};
						const updateSelection = () => {
							menu
								?.querySelectorAll<HTMLButtonElement>('[role="option"]')
								.forEach((option, index) => {
									option.setAttribute("aria-selected", String(index === selected));
									if (index === selected) option.scrollIntoView?.({ block: "nearest" });
								});
						};
						return {
							onStart(props) {
								activeProps = props;
								selected = 0;
								menu = document.createElement("div");
								menu.className = "block-slash-menu";
								menu.setAttribute("role", "listbox");
								menu.setAttribute("aria-label", "Insert block");
								document.body.append(menu);
								window.addEventListener("resize", position);
								window.addEventListener("scroll", position, true);
								scrollTarget = editor.view.dom.closest("[data-editing]");
								scrollTarget?.addEventListener("scroll", position);
								draw();
							},
							onUpdate(props) {
								activeProps = props;
								selected = 0;
								draw();
							},
							onKeyDown({ event }) {
								if (event.key === "Escape") {
									event.preventDefault();
									event.stopPropagation();
									destroy();
									return true;
								}
								if (
									!activeProps?.items.length ||
									!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)
								)
									return false;
								event.preventDefault();
								event.stopPropagation();
								if (event.key === "Enter") choose(selected);
								else {
									selected =
										(selected + (event.key === "ArrowDown" ? 1 : -1) + activeProps.items.length) %
										activeProps.items.length;
									updateSelection();
								}
								return true;
							},
							onExit: destroy,
						};
					},
				}),
			];
		},
	});
}
