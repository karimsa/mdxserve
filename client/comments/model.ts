import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommentThread } from "../../src/comments/schema";
import { useMediaQuery } from "../hooks";
import { DESKTOP_MEDIA } from "../platform";
import { shellInfo } from "../router";
import { openSectionAtom } from "../state";
import { resolutionPosition, type Resolution } from "./anchor";
import { commentActions, useDocThreads, type CommentActions } from "./data";
import { collectDoc, findArticle, resolveIndexOf, resolveInDom } from "./dom";
import { clearHighlights, setHighlights, threadAtPoint, type HighlightEntry } from "./highlights";
import {
	activeThreadAtom,
	commentsOpenAtom,
	commentsSheetOpenAtom,
	popoverThreadAtom,
	replyDraftsAtom,
} from "./state";

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
	openCount: number;
	/** Restricted server: the panel reads, nothing writes. */
	readOnly: boolean;
	/** A section editor is open in this tab: every writing control is disabled (S10). */
	writesDisabled: boolean;
	/** The panel and its TopBar button exist for this doc. */
	available: boolean;
	actions: CommentActions;
	/** Makes a thread active in the list and scrolls the doc to it. */
	selectThread: (id: string) => void;
	/** The thread shown in the popover: desktop with the sidebar closed only, else null. */
	popoverId: string | null;
	showPopover: (id: string) => void;
	closePopover: () => void;
	/** Docks the sidebar with this thread active and closes the popover. */
	openInSidebar: (id: string) => void;
}

/** Panel visibility, switching between the persisted desktop sidebar and the transient phone sheet. */
export function useCommentsPanel() {
	const isDesktop = useMediaQuery(DESKTOP_MEDIA, true);
	const [railOpen, setRailOpen] = useAtom(commentsOpenAtom);
	const [sheetOpen, setSheetOpen] = useAtom(commentsSheetOpenAtom);
	const open = isDesktop ? railOpen : sheetOpen;
	const setOpen = useCallback(
		(next: boolean) => (isDesktop ? setRailOpen(next) : setSheetOpen(next)),
		[isDesktop, setRailOpen, setSheetOpen],
	);
	return { isDesktop, open, setOpen, sidebarOpen: isDesktop && railOpen };
}

function scrollToView(view: ThreadView | undefined, isDesktop: boolean): void {
	if (!view) return;
	const rangeRect = view.range?.getBoundingClientRect();
	const rect =
		rangeRect && (rangeRect.width > 0 || rangeRect.height > 0)
			? rangeRect
			: view.scrollTarget?.getBoundingClientRect();
	if (!rect) return;
	const topbar = document.querySelector("header")?.getBoundingClientRect().height ?? 48;
	// The phone sheet covers the bottom 70% of the screen; centre in what is left.
	const bottom = isDesktop ? window.innerHeight : window.innerHeight * 0.3;
	const room = bottom - topbar;
	const offset = Math.max(topbar + 16, topbar + (room - rect.height) / 2);
	window.scrollTo({ top: Math.max(0, rect.top + window.scrollY - offset), behavior: "smooth" });
}

/**
 * The comments state for the open doc: its threads, where each one lands on the
 * page, the highlights, and click-to-focus. Mount once, in AppShell.
 * `renderVersion` changes whenever DocView reports a render.
 */
export function useCommentsModel(path: string | null, renderVersion: number): CommentsModel {
	const { threads } = useDocThreads(path);
	const editing = useAtomValue(openSectionAtom) !== null;
	const [views, setViews] = useState<ReadonlyMap<string, ThreadView>>(new Map());
	const [activeId, setActiveId] = useAtom(activeThreadAtom);
	const setSheetOpen = useSetAtom(commentsSheetOpenAtom);
	const setRailOpen = useSetAtom(commentsOpenAtom);
	const [popoverThread, setPopoverThread] = useAtom(popoverThreadAtom);
	const setReplyDrafts = useSetAtom(replyDraftsAtom);
	const { isDesktop, sidebarOpen } = useCommentsPanel();
	const readOnly = shellInfo.permissions === "restricted";

	// Another doc starts clean.
	useEffect(() => {
		setActiveId(null);
		setSheetOpen(false);
		setPopoverThread(null);
		setReplyDrafts({});
	}, [path, setActiveId, setSheetOpen, setPopoverThread, setReplyDrafts]);

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
		setHighlights(entries, activeId);
	}, [views, activeId]);
	useEffect(() => clearHighlights, []);

	// A click on highlighted text focuses that thread: in the sidebar when it is open,
	// else in the popover (desktop) or the sheet (phone).
	useEffect(() => {
		if (path === null) return;
		function onClick(event: MouseEvent) {
			if (event.button !== 0 || event.defaultPrevented) return;
			const target = event.target instanceof Element ? event.target : null;
			if (!target?.closest("article.mdx-prose")) return;
			if (target.closest("a, button, input, textarea, [data-editing]")) return;
			if (window.getSelection()?.isCollapsed === false) return;
			const id = threadAtPoint(event.clientX, event.clientY);
			if (!id) return;
			setActiveId(id);
			if (!isDesktop) {
				setSheetOpen(true);
				// The sheet covers the tapped text; once its scroll space is in place,
				// bring the anchor into the part of the page it leaves uncovered.
				requestAnimationFrame(() => scrollToView(views.get(id), isDesktop));
			} else if (!sidebarOpen) setPopoverThread(id);
		}
		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, [path, isDesktop, sidebarOpen, views, setActiveId, setSheetOpen, setPopoverThread]);

	const actions = useMemo(() => commentActions(path ?? ""), [path]);
	const selectThread = useCallback(
		(id: string) => {
			setActiveId(id);
			let view = views.get(id);
			if (!view) {
				// Resolved threads are not kept in `views`; find this one on demand.
				const thread = threads.find((candidate) => candidate.id === id);
				const article = findArticle();
				if (thread && article) {
					const doc = collectDoc(article);
					const { resolution, range, scrollTarget } = resolveInDom(
						doc,
						resolveIndexOf(doc),
						thread.anchor,
					);
					view = { resolution, position: resolutionPosition(resolution), range, scrollTarget };
				}
			}
			scrollToView(view, isDesktop);
		},
		[setActiveId, views, threads, isDesktop],
	);

	const showPopover = useCallback(
		(id: string) => {
			setActiveId(id);
			setPopoverThread(id);
		},
		[setActiveId, setPopoverThread],
	);
	const closePopover = useCallback(() => {
		setPopoverThread(null);
		setActiveId(null);
	}, [setPopoverThread, setActiveId]);
	const openInSidebar = useCallback(
		(id: string) => {
			setPopoverThread(null);
			setRailOpen(true);
			setActiveId(id);
		},
		[setPopoverThread, setRailOpen, setActiveId],
	);

	const openCount = threads.filter((thread) => !thread.resolved).length;
	return {
		path: path ?? "",
		threads,
		views,
		openCount,
		readOnly,
		writesDisabled: readOnly || editing,
		available: path !== null && (!readOnly || threads.length > 0),
		actions,
		selectThread,
		popoverId: isDesktop && !sidebarOpen ? popoverThread : null,
		showPopover,
		closePopover,
		openInSidebar,
	};
}
