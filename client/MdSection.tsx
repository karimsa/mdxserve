import { DiagramEditContext, type ExistingDiagram } from "./diagrams/edit-context";
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
import { DocContext } from "./DocContext";
import { openSectionAtom } from "./state";
import { IconButton } from "./ui/IconButton";
import { pushToast } from "./ui/Toast";

// The Tiptap editor (~300 KB of ProseMirror) must never be part of a doc
// module's own bundle, and must never be evaluated by the SSR render worker
// (client/ssr-entry.tsx), which only ever renders sections in read mode. A
// module-scope `lazy()` call is safe in both places: it just builds a
// component descriptor around a loader, and the loader only actually runs
// when React commits the "edit" branch below, which SSR never reaches.
const loadEditor = () => import("./MdSectionEditor");
const MdSectionEditor = lazy(loadEditor);
const DiagramEditDialog = lazy(() =>
	import("./diagrams/EditDialog").then((module) => ({ default: module.DiagramEditDialog })),
);

// Warm the editor chunk as soon as a pointer lands on any section, so by the
// time the user has double-clicked or reached the pencil the lazy import is
// already cached and the switch into edit mode doesn't wait on the network.
let editorPreloaded = false;
function preloadEditor(): void {
	if (editorPreloaded) return;
	editorPreloaded = true;
	void loadEditor();
}

export interface MdSectionProps {
	/** 0-based order among a doc's sections, as a string (mdxJsxFlowElement attributes are always strings). */
	index: string;
	/** 1-based, inclusive source line numbers, as strings. */
	startLine: string;
	endLine: string;
	children: ReactNode;
}

/**
 * MDXProvider registration (see client/mdx-components.ts) for the synthetic
 * `<MdSection>` element the server's remark-sections compiler plugin wraps
 * around every maximal run of pure-markdown top-level nodes. In read mode
 * it's invisible — same children, same DOM — until hovered, when a pencil
 * appears to swap it into an inline Tiptap editor seeded from the raw file.
 *
 * This outer component only resolves `path` and re-keys the inner `Section`
 * on `path:startLine:endLine`. That key matters after a save: Vite's HMR
 * re-executes the doc module and React Fast Refresh re-renders this
 * component in place with *new* startLine/endLine props (the edited range
 * shifted). Without the key, Fast Refresh would preserve `Section`'s local
 * state across that update and leave it holding an editor pointed at
 * now-stale line numbers; keying on the range forces a clean remount back to
 * read mode instead.
 */
export function MdSection({ index, startLine, endLine, children }: MdSectionProps) {
	const ctxPath = useContext(DocContext)?.path;
	// MdSection also renders inside the SSR worker (client/ssr-entry.tsx, used
	// by the `mdxserve validate` render check via renderToString), which has no
	// router and so no DocContext provider — and no `location` global at all.
	// Read mode never needs `path`, so falling back to "" there is fine.
	const path =
		ctxPath ?? (typeof location !== "undefined" ? decodeURIComponent(location.pathname) : "");

	return (
		<Section
			key={`${path}:${startLine}:${endLine}`}
			path={path}
			index={index}
			startLine={Number(startLine)}
			endLine={Number(endLine)}
		>
			{children}
		</Section>
	);
}

function Section({
	path,
	index,
	startLine,
	endLine,
	children,
}: {
	path: string;
	index: string;
	startLine: number;
	endLine: number;
	children: ReactNode;
}) {
	const [mode, setMode] = useState<"read" | "loading" | "edit" | "diagram">("read");
	const [initialDiagram, setInitialDiagram] = useState<ExistingDiagram | undefined>();
	const [source, setSource] = useState("");
	const [version, setVersion] = useState("");
	const [openSection, setOpenSection] = useAtom(openSectionAtom);
	const key = `${path}:${startLine}:${endLine}`;

	// Only one section edits (or loads) at a time. The atom is claimed the
	// moment a section starts opening, so if a different section claims it
	// while this one is mid-fetch or mid-edit, this one drops back to read
	// mode and discards whatever it had — no confirmation, matching the
	// "explicit Save / Esc cancels, no autosave" model. Claiming up front
	// (rather than when the fetch lands) is what makes a slow earlier click
	// lose to a faster later one instead of clobbering it.
	useEffect(() => {
		if (mode !== "read" && openSection !== key) setMode("read");
	}, [openSection, key, mode]);

	// If this section unmounts while it owns the atom — a navigation away, or
	// the HMR remount after another section's save shifted our line range —
	// release it, or DocView would keep the doc's resize handles hidden.
	useEffect(() => {
		return () => {
			setOpenSection((current) => (current === key ? null : current));
		};
	}, [key, setOpenSection]);

	async function startEdit(target?: ExistingDiagram) {
		// Double-click and the pencil can both fire while a fetch is in flight.
		if (mode !== "read") return;
		setInitialDiagram(target);
		setOpenSection(key);
		setMode("loading");
		try {
			// The vanilla client, not the query cache: the source must be exactly
			// what is on disk at this moment, never a cached copy.
			const data = await trpcClient.getDocSource.query({ path });
			// Functional update so a response that lands after another section
			// took the atom (the effect above has already reset us to "read")
			// is dropped rather than resurrecting this section's editor.
			const lines = data.text.split(/\r?\n/);
			const sliced = lines.slice(startLine - 1, endLine).join("\n");
			setMode((current) => {
				if (current !== "loading") return current;
				setSource(sliced);
				setVersion(data.version);
				return current;
			});
			// A transition, so React keeps the read-mode DOM on screen until the
			// lazy editor chunk has resolved and MdSectionEditor can commit in
			// one go — instead of swapping in the Suspense fallback first and
			// then the editor, which read as a flash.
			startTransition(() => {
				setMode((current) => (current === "loading" ? (target ? "diagram" : "edit") : current));
			});
		} catch {
			pushToast({ tone: "danger", text: "Couldn't open section for editing" });
			setMode((current) => (current === "loading" ? "read" : current));
			setOpenSection((current) => (current === key ? null : current));
		}
	}

	// Called by MdSectionEditor on both Save-success and Cancel — this section
	// is (by construction — see the effect above) still the open one whenever
	// its own editor is what's calling this, so clearing unconditionally is safe.
	function finishEdit() {
		// Only release the atom if it is still ours: a slow save can resolve
		// after another section has claimed it, and clearing unconditionally
		// would close that newer editor and discard its unsaved edits.
		setOpenSection((current) => (current === key ? null : current));
		setMode("read");
	}

	// MdSectionEditor renders its own `.mdx-section[data-editing]` wrapper (it
	// needs to be the direct parent of `.ProseMirror` for the prose rhythm
	// rules in client/design/base/prose.css to reach it), so this branch adds
	// nothing around it — a second `.mdx-section` here would double-nest and
	// throw off the `:is(.mdx-prose, .mdx-section, …) > * + *` selectors.
	//
	// The fallback is the read-mode content itself, not a skeleton: with the
	// transition in startEdit this branch normally never suspends visibly, and
	// if it ever does (chunk evicted, slow network) the section simply stays
	// as it was until the editor is ready.
	if (mode === "edit") {
		return (
			<Suspense
				fallback={
					<div className="mdx-section" data-md-section={index}>
						{children}
					</div>
				}
			>
				<MdSectionEditor
					source={source}
					version={version}
					path={path}
					startLine={startLine}
					endLine={endLine}
					onDone={finishEdit}
				/>
			</Suspense>
		);
	}

	// Double-clicking prose is the fast path into the editor. It has to stay
	// out of the way where a double-click already means something: following/
	// selecting a link, a button (code copy, tabs), a task checkbox, selecting a
	// word inside a code block, and svg-pan-zoom's double-click zoom on a
	// mermaid diagram (client/Mermaid.tsx `dblClickZoomEnabled`).
	function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
		const target = event.target as Element | null;
		if (target?.closest("a, button, input, select, textarea, summary, pre, svg")) return;
		event.preventDefault();
		void startEdit();
	}

	return (
		<DiagramEditContext.Provider
			value={mode === "read" ? (target) => void startEdit(target) : null}
		>
			{mode === "diagram" && initialDiagram && (
				<Suspense fallback={null}>
					<DiagramEditDialog
						source={source}
						target={initialDiagram}
						path={path}
						version={version}
						startLine={startLine}
						endLine={endLine}
						onClose={finishEdit}
					/>
				</Suspense>
			)}
			<div
				className="mdx-section group"
				data-md-section={index}
				onDoubleClick={onDoubleClick}
				onPointerEnter={preloadEditor}
			>
				{children}
				{/* Floats over the section's top-right corner rather than in the left
			    gutter, which is where DocView's left ResizeHandle lives — the two
			    hover affordances were fighting for the same strip of pixels. */}
				<IconButton
					icon="pencil"
					label="Edit section"
					size="sm"
					variant="outline"
					data-print-hide
					disabled={mode === "loading"}
					onClick={() => void startEdit()}
					className="mdx-section-edit absolute -top-3 right-0 z-20 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
				/>
			</div>
		</DiagramEditContext.Provider>
	);
}
