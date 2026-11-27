import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { queryClient, trpc } from "../api";
import { DocContext } from "../DocContext";
import { ErrorBox } from "../ErrorBox";
import { useFullWidth } from "../hooks";
import { ResizeHandle } from "../ui/ResizeHandle";
import { DOC_MAX_WIDTH, DOC_MIN_WIDTH, docWidthAtom, openSectionAtom } from "../state";
import { fragmentOf, indexDocument, resolveFragment, type DocumentIndex } from "./document-index";
import { FootnoteContext, NodeList, footnoteIds } from "./nodes";
import { documentQueryOptions } from "./query";
import { clearOpenDocument, revealNode, setOpenDocument } from "./reveal";
import type { DocumentTree } from "./tree-types";

/** The same map as `previous` when the numbering did not change, so footnote references skip a render. */
function useStableNumbers(numbers: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
	const previous = useRef(numbers);
	const same =
		previous.current.size === numbers.size &&
		[...numbers].every(([label, number]) => previous.current.get(label) === number);
	if (!same) previous.current = numbers;
	return previous.current;
}

const Footnotes = memo(function Footnotes({ index }: { index: DocumentIndex }) {
	if (index.footnotes.length === 0) return null;
	return (
		<section data-footnotes="" className="footnotes">
			<h2 className="sr-only" id="footnote-label">
				Footnotes
			</h2>
			<ol>
				{index.footnotes.map((definition) => {
					const ids = footnoteIds(definition.label);
					const backref = (
						<a
							href={`#${ids.reference}`}
							data-footnote-backref=""
							aria-label={`Back to reference ${index.footnoteNumbers.get(definition.label) ?? ""}`}
						>
							↩
						</a>
					);
					// The back link closes the last paragraph, as GFM renders it.
					const last = definition.children.at(-1);
					if (last?.type !== "paragraph")
						return (
							<li key={definition.label} id={ids.definition}>
								<NodeList nodes={definition.children} /> {backref}
							</li>
						);
					return (
						<li key={definition.label} id={ids.definition}>
							<NodeList nodes={definition.children.slice(0, -1)} />
							<p>
								<NodeList nodes={last.children} /> {backref}
							</p>
						</li>
					);
				})}
			</ol>
		</section>
	);
});

/** Scroll to the node a `#fragment` names, selecting the tabs that hide it. */
function revealFragment(hash: string, tree: DocumentTree, index: DocumentIndex): void {
	const id = resolveFragment(fragmentOf(hash), index, tree.toc);
	if (id !== null) revealNode(id, { behavior: "instant" });
}

/**
 * A document, rendered from the JSON tree `getDocument` returns. Each node
 * renderer is memoized and TanStack Query's structural sharing keeps every
 * unchanged subtree's object across a refetch, so a change on disk re-renders
 * only what changed; tab selections, table sorts and open `details` survive.
 *
 * Memoized: the shell re-renders on every frame of a width change.
 */
export const DocumentView = memo(function DocumentView({
	path,
	onRendered,
}: {
	path: string;
	/**
	 * Fired after each commit of new document content, so the table of
	 * contents and comment anchors re-read the page.
	 */
	onRendered?: () => void;
}) {
	const { data, error } = useQuery(documentQueryOptions(path));
	const fullWidth = useFullWidth();
	const setWidth = useSetAtom(docWidthAtom);
	// While a section is being edited the page width is pinned: a drag would
	// reflow the editor under the caret.
	const editing = useAtomValue(openSectionAtom) !== null;
	const container = useRef<HTMLDivElement>(null);
	const docContext = useMemo(() => ({ path }), [path]);
	const tree = data?.document;
	const index = useMemo(() => (tree ? indexDocument(tree) : null), [tree]);
	const footnoteNumbers = useStableNumbers(index?.footnoteNumbers ?? new Map());

	useLayoutEffect(() => {
		if (!index) return;
		const open = { path, index };
		setOpenDocument(open);
		onRendered?.();
		// Only clear what this view registered: the next document's view can
		// register before this one's cleanup runs.
		return () => clearOpenDocument(open);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [index, path]);

	// A new version of the open document may have a new first h1, which is the
	// title the sidebar and folder listings show.
	const version = data?.version;
	const seenVersion = useRef<{ path: string; version: string } | null>(null);
	useEffect(() => {
		if (version === undefined) return;
		const seen = seenVersion.current;
		seenVersion.current = { path, version };
		if (!seen || seen.path !== path || seen.version === version) return;
		void queryClient.invalidateQueries({ ...trpc.getDocTree.queryFilter(), refetchType: "all" });
		void queryClient.invalidateQueries({ ...trpc.getFolderListing.queryFilter(), type: "active" });
	}, [path, version]);

	// The tree arrives after the browser's own hash jump, and an anchor inside
	// an unselected tab has no box to jump to: honour the fragment once the
	// document is first on the page, and on every later hash change.
	const revealedFor = useRef<string | null>(null);
	useEffect(() => {
		if (!tree || !index || revealedFor.current === path) return;
		revealedFor.current = path;
		if (window.location.hash) revealFragment(window.location.hash, tree, index);
	}, [tree, index, path]);
	useEffect(() => {
		if (!tree || !index) return;
		const onHashChange = () => revealFragment(window.location.hash, tree, index);
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, [tree, index]);

	if (!data) {
		if (error) return <ErrorBox message={error.message} />;
		return null;
	}

	return (
		<div ref={container} className="relative">
			{!editing && !fullWidth && (
				<>
					<ResizeHandle
						side="left"
						container={container}
						onResize={setWidth}
						label="Resize page"
						minWidth={DOC_MIN_WIDTH}
						maxWidth={DOC_MAX_WIDTH}
					/>
					<ResizeHandle
						side="right"
						container={container}
						onResize={setWidth}
						label="Resize page"
						minWidth={DOC_MIN_WIDTH}
						maxWidth={DOC_MAX_WIDTH}
					/>
				</>
			)}
			<article className="mdx-prose min-w-0 max-w-full">
				<DocContext value={docContext}>
					<FootnoteContext value={footnoteNumbers}>
						<NodeList nodes={data.document.children} />
						{index ? <Footnotes index={index} /> : null}
					</FootnoteContext>
				</DocContext>
			</article>
		</div>
	);
});
