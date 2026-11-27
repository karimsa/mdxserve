import { AnimatePresence } from "framer-motion";
import {
	lazy,
	startTransition,
	Suspense,
	useContext,
	useEffect,
	useState,
	type MouseEvent,
	type ReactNode,
} from "react";
import { useAtom } from "jotai";
import { trpcClient } from "./api";
import { DocContext } from "@mdxserve/ui/document/DocContext";
import { openSectionAtom } from "./state";
import { shellInfo } from "./router";
import { IconButton } from "./ui/IconButton";
import { pushToast } from "./ui/Toast";

// The Tiptap editor (~300 KB of ProseMirror) loads only when a reader opens
// an editor; the loader runs when React commits the "edit" branch below.
const loadEditor = () => import("./MdSectionEditor");

/**
 * Stands in for an editor whose chunk failed to load, which happens when the server was
 * updated after the page loaded (see stale-build.ts, which reloads or tells the reader).
 * It closes the editor, so the page shows the content again and does not go blank.
 */
function ClosedOnLoadFailure({ close }: { close: () => void }) {
	useEffect(close, [close]);
	return null;
}

const MdSectionEditor = lazy<typeof import("./MdSectionEditor").default>(() =>
	loadEditor().catch(() => ({
		default: ({ onDone }) => <ClosedOnLoadFailure close={onDone} />,
	})),
);
const DiagramEditDialog = lazy<typeof import("./diagrams/EditDialog").DiagramEditDialog>(() =>
	import("./diagrams/EditDialog").then(
		(module) => ({ default: module.DiagramEditDialog }),
		() => ({ default: ({ onClose }) => <ClosedOnLoadFailure close={onClose} /> }),
	),
);

// Warm the editor chunk as soon as a pointer lands on any section, so by the
// time the user has double-clicked or reached the pencil the lazy import is
// already cached and the switch into edit mode doesn't wait on the network.
let editorPreloaded = false;
function preloadEditor(): void {
	if (editorPreloaded) return;
	editorPreloaded = true;
	// A failure is handled when the editor is opened.
	loadEditor().catch(() => undefined);
}

type EditMode = "read" | "loading" | "open";

/**
 * The edit state of one node, addressed by its id: fetches the node's source
 * (`getNodeSource`) when opened and keeps the version it was read at for the
 * save. Only one node edits at a time across the page: opening claims
 * `openSectionAtom`, and a node that loses it drops back to read mode,
 * discarding what it had open (no autosave; Save or Esc).
 */
function useNodeEditor(id: string) {
	const path = useContext(DocContext)?.path ?? "";
	const [mode, setMode] = useState<EditMode>("read");
	const [source, setSource] = useState("");
	const [version, setVersion] = useState("");
	const [openSection, setOpenSection] = useAtom(openSectionAtom);
	const key = `${path}:${id}`;
	const editable = shellInfo.permissions !== "restricted";

	useEffect(() => {
		if (mode !== "read" && openSection !== key) setMode("read");
	}, [openSection, key, mode]);

	// Release the atom if this node unmounts while it owns it (a navigation
	// away, or the node leaving the document), or the page keeps its resize
	// handles hidden.
	useEffect(() => {
		return () => {
			setOpenSection((current) => (current === key ? null : current));
		};
	}, [key, setOpenSection]);

	async function open() {
		if (!editable || mode !== "read") return;
		setOpenSection(key);
		setMode("loading");
		try {
			// The vanilla client, not the query cache: the source must be exactly
			// what is on disk at this moment, never a cached copy.
			const data = await trpcClient.getNodeSource.query({ path, id });
			setMode((current) => {
				if (current !== "loading") return current;
				setSource(data.markdown);
				setVersion(data.version);
				return current;
			});
			// A transition, so the read-mode DOM stays until the lazy editor chunk
			// has resolved and the editor commits in one go.
			startTransition(() => {
				setMode((current) => (current === "loading" ? "open" : current));
			});
		} catch {
			pushToast({ tone: "danger", text: "Couldn't open this block for editing" });
			setMode((current) => (current === "loading" ? "read" : current));
			setOpenSection((current) => (current === key ? null : current));
		}
	}

	function close() {
		// Only release the atom if it is still ours: a slow save can resolve
		// after another node has claimed it.
		setOpenSection((current) => (current === key ? null : current));
		setMode("read");
	}

	return { path, mode, source, version, editable, open, close };
}

export interface MdSectionProps {
	/** The node's id in the document tree: a section, the preamble, or a block builtin. */
	id: string;
	/** A block builtin sits inside a section and keeps its own pencil. */
	kind: "section" | "block";
	children: ReactNode;
}

/**
 * An editable block of the document: a level 1 or 2 section (or the content
 * before the first heading), or a block builtin. In read mode it is
 * invisible — same children, same DOM — until hovered, when a pencil appears
 * to swap it into an inline Tiptap editor seeded with the node's source. A
 * double-click on its prose opens the editor too.
 */
export function MdSection({ id, kind, children }: MdSectionProps) {
	const editor = useNodeEditor(id);
	const group = kind === "section" ? "group/section" : "group/block";
	const reveal =
		kind === "section" ? "group-hover/section:opacity-100" : "group-hover/block:opacity-100";

	if (editor.mode === "open") {
		// MdSectionEditor renders its own `.mdx-section[data-editing]` wrapper (it
		// must be the direct parent of `.ProseMirror` for the prose rhythm rules
		// to reach it). The fallback is the read-mode content itself.
		return (
			<Suspense
				fallback={
					<div className="mdx-section" data-node-id={id}>
						{children}
					</div>
				}
			>
				<MdSectionEditor
					source={editor.source}
					version={editor.version}
					path={editor.path}
					id={id}
					onDone={editor.close}
				/>
			</Suspense>
		);
	}

	// Double-clicking prose is the fast path into the editor. It stays out of
	// the way where a double-click already means something: a link, a button
	// (code copy, tabs), a task checkbox, a word inside a code block,
	// svg-pan-zoom's double-click zoom on a diagram, and the inline table of
	// contents, which is not document content.
	function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
		const target = event.target as Element | null;
		if (target?.closest("a, button, input, select, textarea, summary, pre, svg, [data-toc-above]"))
			return;
		// The innermost editable block takes it.
		event.stopPropagation();
		event.preventDefault();
		void editor.open();
	}

	return (
		<div
			className={`mdx-section ${group}`}
			data-node-id={id}
			onDoubleClick={editor.editable ? onDoubleClick : undefined}
			onPointerEnter={editor.editable ? preloadEditor : undefined}
		>
			{children}
			{/* Floats over the block's top-right corner rather than in the left
			    gutter, which is where the page's left resize handle lives. */}
			{editor.editable && (
				<IconButton
					icon="pencil"
					label={kind === "section" ? "Edit section" : "Edit block"}
					size="sm"
					variant="outline"
					data-print-hide
					disabled={editor.mode === "loading"}
					onClick={() => void editor.open()}
					className={`mdx-section-edit absolute -top-3 right-0 z-20 opacity-0 shadow-sm transition-opacity ${reveal} focus-visible:opacity-100`}
				/>
			)}
		</div>
	);
}

/**
 * The edit action of a mermaid block: opens the diagram dialog on the block's
 * own source and saves it back by the block's id. `render` receives the
 * handler to put on the block's Edit button, or undefined where the reader
 * may not edit.
 */
export function DiagramEditor({
	id,
	value,
	render,
}: {
	id: string;
	/** The diagram text as rendered, to find the fence in the fetched source. */
	value: string;
	render: (onEdit: (() => void) | undefined) => ReactNode;
}) {
	const editor = useNodeEditor(id);
	return (
		<>
			<AnimatePresence>
				{editor.mode === "open" && (
					<Suspense fallback={null}>
						<DiagramEditDialog
							source={editor.source}
							target={{ index: 0, source: value }}
							path={editor.path}
							id={id}
							version={editor.version}
							onClose={editor.close}
						/>
					</Suspense>
				)}
			</AnimatePresence>
			{render(editor.editable ? () => void editor.open() : undefined)}
		</>
	);
}
