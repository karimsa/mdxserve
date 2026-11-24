import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import type { CommentThread } from "../../src/comments/schema";
import { openSectionAtom } from "../state";
import { resolutionPosition, type Resolution } from "./anchor";
import { useDocThreads } from "./data";
import { collectDoc, findArticle, resolveIndexOf, resolveInDom } from "./dom";
import { clearHighlights, setHighlights, type HighlightEntry } from "./highlights";

export interface ThreadView {
	resolution: Resolution;
	/** Document position for ordering; see `resolutionPosition`. */
	position: number;
	range: Range | null;
	scrollTarget: Element | null;
}

export interface CommentsModel {
	path: string;
	threads: CommentThread[];
	/** Resolution of every unresolved thread. Resolved threads are not resolved against the page. */
	views: ReadonlyMap<string, ThreadView>;
}

/**
 * The comments state for the open doc: its threads, where each one lands on the
 * page, and the highlights. Mount once, in AppShell.
 * `renderVersion` changes whenever DocView reports a render.
 */
export function useCommentsModel(path: string | null, renderVersion: number): CommentsModel {
	const { threads } = useDocThreads(path);
	const editing = useAtomValue(openSectionAtom) !== null;
	const [views, setViews] = useState<ReadonlyMap<string, ThreadView>>(new Map());

	// Bumped when a tab panel is shown or hidden, so anchors re-resolve.
	const [visibility, setVisibility] = useState(0);
	useEffect(() => {
		const article = findArticle();
		if (!article) return;
		const observer = new MutationObserver(() => setVisibility((count) => count + 1));
		observer.observe(article, {
			attributes: true,
			attributeFilter: ["inert", "aria-hidden"],
			subtree: true,
		});
		return () => observer.disconnect();
	}, [path, renderVersion]);

	// Resolve after the thread list changes, after DocView renders, and when a
	// section editor closes. While one is open its DOM is the editor's, so keep
	// the last answer rather than flash everything to "detached".
	useEffect(() => {
		if (path === null || editing) return;
		const article = findArticle();
		if (!article) {
			setViews(new Map());
			return;
		}
		const doc = collectDoc(article);
		const index = resolveIndexOf(doc);
		const next = new Map<string, ThreadView>();
		for (const thread of threads) {
			if (thread.resolved) continue;
			const { resolution, range, scrollTarget } = resolveInDom(doc, index, thread.anchor);
			next.set(thread.id, {
				resolution,
				position: resolutionPosition(resolution),
				range,
				scrollTarget,
			});
		}
		setViews(next);
	}, [path, threads, renderVersion, editing, visibility]);

	useEffect(() => {
		const entries: HighlightEntry[] = [];
		for (const [threadId, view] of views) {
			if (view.range) entries.push({ threadId, range: view.range });
		}
		setHighlights(entries, null);
	}, [views]);
	useEffect(() => clearHighlights, []);

	return { path: path ?? "", threads, views };
}
