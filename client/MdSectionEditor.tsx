import { useEffect, useState, type KeyboardEvent } from "react";
import type { Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Image } from "@tiptap/extension-image";
import { Markdown } from "@tiptap/markdown";
import { motion } from "framer-motion";
import { T } from "./motion";
import { isApplePlatform } from "./platform";
import { Kbd } from "./ui/Kbd";
import { pushToast } from "./ui/Toast";

// The two hints enter together, each springing a few px rightwards while it
// fades in, the second a beat after the first.
const hintStack = { animate: { transition: { staggerChildren: 0.05 } } };
const hint = {
	initial: { opacity: 0, x: -10 },
	animate: { opacity: 1, x: 0, transition: T.glide },
};

export interface MdSectionEditorProps {
	/** Raw markdown for exactly [startLine, endLine], sliced by MdSection.tsx. */
	source: string;
	/** mtime of the whole file at the moment `source` was fetched — the save's stale-write guard. */
	mtime: number;
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
	source,
	mtime,
	path,
	startLine,
	endLine,
	onDone,
}: MdSectionEditorProps) {
	const [saving, setSaving] = useState(false);
	// Drives the hints' entrance. Not framer's `initial`/`animate` on mount:
	// this component mounts through Suspense inside a transition, and its
	// first commit can happen while the subtree is still hidden, so a
	// mount-time animation has already finished by the time it's on screen.
	// Flipping state in the post-mount effect below starts the spring on the
	// visible commit instead.
	const [entered, setEntered] = useState(false);

	const editor = useEditor({
		extensions: [
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

	async function save() {
		if (!editor || saving) return;
		setSaving(true);
		try {
			const res = await fetch("/__mdxserve/api/save", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					path,
					startLine,
					endLine,
					mtime,
					markdown: editor.getMarkdown(),
				}),
			});

			if (res.ok) {
				// The write lands on disk, chokidar → Vite HMR re-executes the doc
				// module, and Fast Refresh re-renders this section's MdSection
				// wrapper with fresh line numbers — no need to do anything here
				// beyond leaving edit mode.
				onDone();
				return;
			}
			if (res.status === 409) {
				pushToast({
					tone: "warn",
					title: "File changed on disk",
					message: "Reopen the section to edit the newer version.",
				});
				return;
			}
			if (res.status === 422) {
				const body = (await res.json().catch(() => null)) as { error?: string } | null;
				pushToast({
					tone: "danger",
					title: "Couldn't save section",
					message: body?.error ?? "The edited markdown doesn't compile.",
				});
				return;
			}
			throw new Error(`save failed: ${res.status}`);
		} catch {
			pushToast({ tone: "danger", title: "Couldn't save section" });
		} finally {
			setSaving(false);
		}
	}

	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
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
		<div className="mdx-section" data-editing onKeyDown={onKeyDown}>
			<EditorContent editor={editor} />
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
			</motion.div>
		</div>
	);
}
