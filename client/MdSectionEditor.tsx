import {
	findDiagram,
	replaceDiagram,
	mermaidEditButtons,
	type DiagramEditTarget,
} from "./diagrams/edit-block";
import type { ExistingDiagram } from "./diagrams/edit-context";
import { mermaidSlash } from "./diagrams/slash";
import { MermaidDialog } from "./diagrams/Dialog";
import type { Range } from "@tiptap/core";
import {
	useEffect,
	useState,
	useRef,
	useCallback,
	type KeyboardEvent,
	type MouseEvent,
} from "react";
import type { Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Image } from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import { motion } from "framer-motion";
import { isTRPCClientError } from "@trpc/client";
import { trpcClient } from "./api";
import { TRANSITIONS } from "./motion";
import { isApplePlatform } from "./platform";
import { modifiedLinkHref } from "./editor-link";
import { Kbd } from "./ui/Kbd";
import { pushToast } from "./ui/Toast";

// The two hints enter together, each springing a few px rightwards while it
// fades in, the second a beat after the first.
const hintStack = { animate: { transition: { staggerChildren: 0.05 } } };
const hint = {
	initial: { opacity: 0, x: -10 },
	animate: { opacity: 1, x: 0, transition: TRANSITIONS.glide },
};

export interface MdSectionEditorProps {
	initialDiagram?: ExistingDiagram;
	/** Raw markdown for exactly [startLine, endLine], sliced by MdSection.tsx. */
	source: string;
	/** Version token for the whole file at the moment `source` was fetched — the save's stale-write guard. */
	version: string;
	path: string;
	startLine: number;
	endLine: number;
	/** Called after a successful save, or on Cancel — either way the section returns to read mode. */
	onDone: () => void;
}

/**
 * Markdown soft line breaks (a hard-wrapped paragraph in the source) survive
 * @tiptap/markdown's parse as literal "\n" inside text nodes, and `.ProseMirror`
 * renders with `white-space: pre-wrap`, so a paragraph wrapped at 80 columns
 * on disk would show up in the editor broken across lines mid-sentence. Turn
 * them into spaces up front — exactly what every Markdown renderer does with a
 * soft break — leaving code blocks alone, where "\n" is real content. Text
 * nodes are rebuilt with their own marks so bold/italic/link spans that
 * happened to straddle a wrap keep their formatting. The edited paragraph is
 * therefore written back as one line on save.
 */
function unwrapSoftBreaks(editor: Editor): void {
	if (editor.isDestroyed) return;
	const { state } = editor;
	const edits: { from: number; to: number; text: string; marks: readonly Mark[] }[] = [];
	state.doc.descendants((node, pos, parent) => {
		if (!node.isText || !node.text?.includes("\n")) return;
		if (parent?.type.name === "codeBlock") return;
		edits.push({
			from: pos,
			to: pos + node.nodeSize,
			text: node.text.replace(/\n/g, " "),
			marks: node.marks,
		});
	});
	if (edits.length === 0) return;
	const tr = state.tr;
	// Apply back to front so earlier positions stay valid.
	for (const edit of edits.reverse()) {
		tr.replaceWith(edit.from, edit.to, state.schema.text(edit.text, edit.marks));
	}
	editor.view.dispatch(tr.setMeta("addToHistory", false));
}

/**
 * The Tiptap editing surface for one `MdSection`. This is the module
 * `client/MdSection.tsx` lazy-loads on click, so its ~300 KB of ProseMirror
 * never ships with a doc's own bundle and is never touched by the SSR render
 * worker (which only ever renders sections in read mode).
 *
 * `StarterKit` 3.29 bundles Link, Underline and Strike itself (confirmed in
 * node_modules/@tiptap/starter-kit/src/starter-kit.ts), so no separate
 * `@tiptap/extension-link` install is needed to configure `link`.
 */
export default function MdSectionEditor({
	initialDiagram,
	source,
	version,
	path,
	startLine,
	endLine,
	onDone,
}: MdSectionEditorProps) {
	const [saving, setSaving] = useState(false);
	const diagramEnabled = useRef(false);
	const [diagramReady, setDiagramReady] = useState(false);
	const [editTarget, setEditTarget] = useState<DiagramEditTarget | null>(null);
	const openedDiagram = useRef(false);
	const [diagramRange, setDiagramRange] = useState<Range | null>(null);
	const openDiagram = useRef<(range: Range) => void>(() => {});
	openDiagram.current = setDiagramRange;
	useEffect(() => {
		let active = true;
		const refresh = () => {
			void trpcClient.getDiagramPreferences
				.query({})
				.then((settings) => {
					if (active) {
						diagramEnabled.current = settings.agent !== "disabled";
						setDiagramReady(diagramEnabled.current);
						if (!diagramEnabled.current) {
							setDiagramRange(null);
							setEditTarget(null);
						}
					}
				})
				.catch(() => {
					diagramEnabled.current = false;
				});
		};
		refresh();
		window.addEventListener("mdxserve-diagram-preferences", refresh);
		return () => {
			active = false;
			window.removeEventListener("mdxserve-diagram-preferences", refresh);
		};
	}, []);
	// Drives the hints' entrance. Not framer's `initial`/`animate` on mount:
	// this component mounts through Suspense inside a transition, and its
	// first commit can happen while the subtree is still hidden, so a
	// mount-time animation has already finished by the time it's on screen.
	// Flipping state in the post-mount effect below starts the spring on the
	// visible commit instead.
	const [entered, setEntered] = useState(false);

	const editor = useEditor({
		extensions: [
			mermaidEditButtons(() => diagramEnabled.current, setEditTarget),
			mermaidSlash(
				() => diagramEnabled.current,
				(range) => openDiagram.current(range),
			),
			StarterKit.configure({
				heading: { levels: [1, 2, 3, 4, 5, 6] },
				link: { openOnClick: false },
			}),
			TaskList,
			TaskItem.configure({ nested: true }),
			TableKit,
			Image,
			Markdown,
		],
		content: source,
		contentType: "markdown",
		onCreate: ({ editor: created }) => unwrapSoftBreaks(created),
		editorProps: { attributes: { class: "mdx-editor", "aria-label": "Section editor" } },
	});

	// Not `autofocus`: useEditor creates the editor before <EditorContent>
	// below has attached its view to the DOM, so focusing at creation time is
	// a no-op. This effect runs after the child's effects, i.e. once the view
	// is mounted, for both the pencil and the double-click entry paths.
	//
	// The `isDestroyed` guard is load-bearing: this component mounts through
	// React.lazy + Suspense, and useEditor can hand the first committed render
	// an instance it has already torn down and is about to replace. Reading
	// `.commands` on a destroyed Editor dereferences a null commandManager and
	// throws; the replacement instance re-runs this effect and focuses.
	useEffect(() => {
		if (!editor || editor.isDestroyed) return;
		editor.commands.focus("start");
		setEntered(true);
	}, [editor]);

	useEffect(() => {
		if (!editor || editor.isDestroyed || !initialDiagram || openedDiagram.current) return;
		openedDiagram.current = true;
		const target = findDiagram(editor, initialDiagram);
		if (target) setEditTarget(target);
		else
			pushToast({
				tone: "warn",
				text: "Diagram changed on disk. Reopen the section before editing.",
			});
	}, [editor, initialDiagram]);

	useEffect(() => {
		if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr);
	}, [editor, diagramReady]);

	const closeDiagram = useCallback(() => {
		setDiagramRange(null);
		setEditTarget(null);
		editor?.commands.focus();
	}, [editor]);

	async function save() {
		if (!editor || saving) return;
		setSaving(true);
		try {
			await trpcClient.saveDocSection.mutate({
				path,
				startLine,
				endLine,
				version,
				markdown: editor.getMarkdown(),
			});
			// The write lands on disk, chokidar → Vite HMR re-executes the doc
			// module, and Fast Refresh re-renders this section's MdSection
			// wrapper with fresh line numbers — no need to do anything here
			// beyond leaving edit mode.
			onDone();
		} catch (error) {
			const code = isTRPCClientError(error) ? error.data?.code : undefined;
			if (code === "CONFLICT") {
				pushToast({ tone: "warn", text: "File changed on disk — reopen the section" });
			} else if (code === "UNPROCESSABLE_CONTENT") {
				console.error(error);
				pushToast({ tone: "danger", text: "Couldn't save — the markdown doesn't compile" });
			} else {
				console.error(error);
				pushToast({ tone: "danger", text: "Couldn't save section" });
			}
		} finally {
			setSaving(false);
		}
	}

	// Cmd/ctrl+click follows a link (client/editor-link.ts says why the
	// browser's own new-tab gesture is inert inside a contenteditable). A DOM
	// `click` listener rather than ProseMirror's `handleClick` prop: that one
	// only fires when ProseMirror's own mousedown→mouseup tracking survives,
	// and it bails on a few pixels of pointer drift. The opener is a detached
	// `target=_blank` anchor rather than `window.open`, which Chrome turns into
	// a popup window as soon as a feature string (even `noopener`) is passed;
	// `noopener` because the target may be any site the doc links to.
	function onClick(event: MouseEvent<HTMLDivElement>) {
		const anchor = (event.target as Element | null)?.closest("a");
		if (!anchor) return;
		// The raw attribute, not `anchor.href`: an empty target (`[label]()`)
		// resolves to the current page and would open a duplicate tab.
		const href = modifiedLinkHref(event, anchor.getAttribute("href"));
		if (!href) return;
		event.preventDefault();
		const opener = document.createElement("a");
		opener.href = href;
		opener.target = "_blank";
		opener.rel = "noopener noreferrer";
		opener.click();
	}

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (diagramRange || editTarget) return;
		if ((event.metaKey || event.ctrlKey) && event.key === "s") {
			event.preventDefault();
			void save();
			return;
		}
		if (event.key === "Escape") {
			// Cancel discards immediately — no confirmation, matching the
			// no-autosave model: nothing was ever written until Save.
			event.preventDefault();
			onDone();
		}
	}

	// Editor construction is synchronous but not instant on first mount;
	// render nothing rather than a half-built surface.
	if (!editor) return null;

	return (
		<div className="mdx-section" data-editing onClick={onClick} onKeyDown={onKeyDown}>
			<EditorContent editor={editor} />
			{(diagramRange || editTarget) && (
				<MermaidDialog
					initialSource={editTarget?.source}
					onClose={closeDiagram}
					onInsert={(source) => {
						if (editTarget) {
							if (!replaceDiagram(editor, editTarget, source)) {
								pushToast({
									tone: "warn",
									text: "Diagram changed. Reopen it before applying changes.",
								});
								return;
							}
							closeDiagram();
							return;
						}
						if (!diagramRange) return;
						if (diagramRange.to > editor.state.doc.content.size) {
							closeDiagram();
							return;
						}
						const from = editor.state.doc.resolve(diagramRange.from);
						if (
							from.parent.type.name !== "paragraph" ||
							from.parent.textContent !==
								editor.state.doc.textBetween(diagramRange.from, diagramRange.to)
						) {
							pushToast({
								tone: "warn",
								text: "Insertion location changed. Close the dialog and choose a new block.",
							});
							return;
						}
						editor
							.chain()
							.focus()
							.insertContentAt(
								{ from: from.before(), to: from.after() },
								{
									type: "codeBlock",
									attrs: { language: "mermaid" },
									content: [{ type: "text", text: source }],
								},
							)
							.run();
						closeDiagram();
					}}
				/>
			)}
			{/* Keyboard is the only way out of edit mode (no buttons), so the hints
			    float in the right gutter beside the frame, out of the text flow —
			    the section keeps its read-mode box exactly. pointer-events-none so
			    the right ResizeHandle underneath still works. */}
			<motion.div
				aria-hidden="true"
				className="pointer-events-none absolute top-0 left-[calc(100%+var(--space-8))] z-20 flex w-max flex-col gap-1.5 text-[length:var(--size-xs)] text-text-subtle"
				variants={hintStack}
				initial="initial"
				animate={entered ? "animate" : "initial"}
			>
				<motion.span variants={hint} className="flex items-center gap-1.5">
					<Kbd>{isApplePlatform() ? "⌘S" : "Ctrl S"}</Kbd> to save
				</motion.span>
				<motion.span variants={hint} className="flex items-center gap-1.5">
					<Kbd>Esc</Kbd> to cancel
				</motion.span>
				<motion.span variants={hint} className="flex items-center gap-1.5">
					<Kbd>{isApplePlatform() ? "⌘" : "Ctrl"}</Kbd> click to follow a link
				</motion.span>
			</motion.div>
		</div>
	);
}
