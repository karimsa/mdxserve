import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	resolutionPosition,
	resolveAnchor,
	type Resolution,
} from "@mdxserve/client/comments/anchor";
import { marksOf, type TextMark } from "@mdxserve/client/comments/marks";
import {
	groupThreads,
	type CommentThread,
	type GroupedThreads,
} from "@mdxserve/client/comments/threads";
import { collectTreeBlocks, type TreeBlocks } from "@mdxserve/client/comments/tree-blocks";
import type { TabStep } from "@mdxserve/client/document/document-index";
import type { DocumentTree } from "@mdxserve/client/document/tree-types";
import type { CommentMarks } from "@mdxserve/ui/document/comment-marks";
import type { DocumentRows } from "../document/rows";

/** The marks and row markers the document's text reads, outside React state so a change redraws only what it touches. */
export interface CommentsStore extends CommentMarks {
	/** The open threads placed in a list row, in document order. */
	rowThreads(row: number): readonly string[] | undefined;
	/** The reader tapped a row's comment marker. */
	pressRow(row: number): void;
}

const EMPTY: readonly string[] = [];

function sameMarks(left: readonly TextMark[], right: readonly TextMark[]): boolean {
	return (
		left.length === right.length &&
		left.every(
			(mark, index) =>
				mark.start === right[index].start &&
				mark.end === right[index].end &&
				mark.threadId === right[index].threadId,
		)
	);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((id, index) => id === right[index]);
}

function createStore(handlers: {
	current: { pressMark(ids: readonly string[]): void; pressRow(row: number): void };
}) {
	const listeners = new Set<() => void>();
	let marks = new Map<object, readonly TextMark[]>();
	let rows = new Map<number, readonly string[]>();
	let active: string | null = null;
	const notify = () => {
		for (const listener of [...listeners]) listener();
	};
	const store: CommentsStore & {
		update(next: Map<object, TextMark[]>, nextRows: Map<number, string[]>): void;
		setActive(id: string | null): void;
	} = {
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		marksOf: (source) => marks.get(source),
		activeThread: () => active,
		pressMark: (ids) => handlers.current.pressMark(ids),
		rowThreads: (row) => rows.get(row),
		pressRow: (row) => handlers.current.pressRow(row),
		update(next, nextRows) {
			// An unchanged node keeps its array, so its text does not redraw.
			const kept = new Map<object, readonly TextMark[]>();
			for (const [source, list] of next) {
				const previous = marks.get(source);
				kept.set(source, previous && sameMarks(previous, list) ? previous : list);
			}
			const keptRows = new Map<number, readonly string[]>();
			for (const [row, ids] of nextRows) {
				const previous = rows.get(row);
				keptRows.set(row, previous && sameIds(previous, ids) ? previous : ids);
			}
			marks = kept;
			rows = keptRows;
			notify();
		},
		setActive(id) {
			if (active === id) return;
			active = id;
			notify();
		},
	};
	return store;
}

/** Where choosing a thread moves the document: a list row and the tabs to select on the way. */
interface Place {
	row: number;
	tabSteps: readonly TabStep[];
}

function placeOf(resolution: Resolution, blocks: TreeBlocks, rows: DocumentRows): Place | null {
	if (resolution.state === "detached") return null;
	if (resolution.block === -1) return { row: 0, tabSteps: [] };
	const block = blocks.blocks[resolution.block];
	const row = block ? rows.rowOfNode.get(block.container) : undefined;
	return row === undefined ? null : { row, tabSteps: block.tabSteps };
}

export interface CommentsModel {
	threads: readonly CommentThread[];
	grouped: GroupedThreads;
	/** Where each open thread's anchor was found. */
	resolutions: ReadonlyMap<string, Resolution>;
	store: CommentsStore;
	open: boolean;
	setOpen(open: boolean): void;
	tab: "open" | "resolved";
	setTab(tab: "open" | "resolved"): void;
	activeId: string | null;
	/** Makes a thread active and moves the document to its text (KA4). */
	selectThread(id: string): void;
	/** Whether the panel takes the whole height under the document (narrow windows only). */
	expanded: boolean;
	setExpanded(expanded: boolean): void;
	/** The thread VoiceOver moves to: the one a highlight or a row marker opened the panel on. */
	focusId: string | null;
}

/**
 * The comments state of the open document: its threads, where each one's text is in the tree
 * (the web's block model, `collectTreeBlocks`, resolved by the web's `resolveAnchor`), the
 * highlights and row markers they draw, and the panel. The panel starts closed.
 */
export function useCommentsModel({
	tree,
	rows,
	threads,
	revealRow,
}: {
	tree: DocumentTree | undefined;
	rows: DocumentRows | null;
	threads: readonly CommentThread[];
	revealRow(row: number, tabSteps: readonly TabStep[]): void;
}): CommentsModel {
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<"open" | "resolved">("open");
	const [activeId, setActiveId] = useState<string | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [focusId, setFocusId] = useState<string | null>(null);
	const setPanelOpen = useCallback((next: boolean) => {
		setOpen(next);
		if (!next) {
			setFocusId(null);
			setExpanded(false);
		}
	}, []);

	const blocks = useMemo(() => (tree ? collectTreeBlocks(tree) : null), [tree]);
	const resolutions = useMemo(() => {
		const found = new Map<string, Resolution>();
		if (!blocks) return found;
		for (const thread of threads)
			if (!thread.resolved) found.set(thread.id, resolveAnchor(thread.anchor, blocks.index));
		return found;
	}, [blocks, threads]);
	const grouped = useMemo(
		() => groupThreads(threads, viewsOf(resolutions)),
		[threads, resolutions],
	);

	const handlers = useRef({ pressMark: (_: readonly string[]) => {}, pressRow: (_: number) => {} });
	const [store] = useState(() => createStore(handlers));

	// Every open thread's marks, and the open threads each row holds, in document order.
	useEffect(() => {
		const rowThreads = new Map<number, string[]>();
		if (blocks && rows)
			for (const thread of grouped.open) {
				const resolution = resolutions.get(thread.id);
				if (!resolution || (resolution.state === "section" && resolution.block === -1)) continue;
				const place = placeOf(resolution, blocks, rows);
				if (!place) continue;
				const list = rowThreads.get(place.row);
				if (list) list.push(thread.id);
				else rowThreads.set(place.row, [thread.id]);
			}
		store.update(blocks ? marksOf(blocks, resolutions) : new Map(), rowThreads);
	}, [store, blocks, rows, resolutions, grouped]);

	useEffect(() => store.setActive(activeId), [store, activeId]);

	// A thread that is gone (resolved elsewhere stays: it moves tabs) is no longer active.
	useEffect(() => {
		if (activeId !== null && !threads.some((thread) => thread.id === activeId)) setActiveId(null);
	}, [threads, activeId]);

	const selectThread = useCallback(
		(id: string) => {
			setActiveId(id);
			setExpanded(false);
			const thread = threads.find((candidate) => candidate.id === id);
			if (!thread || !blocks || !rows) return;
			// A resolved thread is not resolved against the document until the reader chooses it.
			const resolution = resolutions.get(id) ?? resolveAnchor(thread.anchor, blocks.index);
			const place = placeOf(resolution, blocks, rows);
			if (place) revealRow(place.row, place.tabSteps);
		},
		[threads, blocks, rows, resolutions, revealRow],
	);

	/** Opens the panel on the Open tab with one of `ids` active: the active one if it is among them. */
	const showOneOf = useCallback(
		(ids: readonly string[]) => {
			if (ids.length === 0) return;
			const byPosition = [...ids].sort((left, right) => {
				const leftResolution = resolutions.get(left);
				const rightResolution = resolutions.get(right);
				return (
					(leftResolution ? resolutionPosition(leftResolution) : Infinity) -
					(rightResolution ? resolutionPosition(rightResolution) : Infinity)
				);
			});
			const current = store.activeThread();
			const chosen = current !== null && ids.includes(current) ? current : byPosition[0];
			setActiveId(chosen);
			setFocusId(chosen);
			setTab("open");
			setOpen(true);
		},
		[resolutions, store],
	);
	handlers.current = {
		pressMark: showOneOf,
		pressRow: (row) => showOneOf(store.rowThreads(row) ?? EMPTY),
	};

	return {
		threads,
		grouped,
		resolutions,
		store,
		open,
		setOpen: setPanelOpen,
		tab,
		setTab,
		activeId,
		selectThread,
		expanded,
		setExpanded,
		focusId,
	};
}

function viewsOf(resolutions: ReadonlyMap<string, Resolution>) {
	const views = new Map<string, { resolution: Resolution }>();
	for (const [id, resolution] of resolutions) views.set(id, { resolution });
	return views;
}
