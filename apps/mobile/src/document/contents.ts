import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import type { TocEntry } from "@mdxserve/client/document/tree-types";

/** One line of the table of contents: a heading or a tab, indented by its depth. */
export interface TocLine {
	id: string;
	label: string;
	depth: number;
	kind: "heading" | "tab";
	/** A heading's level (2 for `##`), or null for a tab. */
	level: number | null;
}

/**
 * The tree's table of contents in reading order, depth first, as the web's "On this page"
 * lists it. `levels` is the heading level of every section, by id (`DocumentIndex.sectionLevels`).
 */
export function tocLines(
	entries: readonly TocEntry[],
	levels: ReadonlyMap<string, number>,
	depth = 0,
): TocLine[] {
	return entries.flatMap((entry) => [
		{
			id: entry.id,
			label: entry.label,
			depth,
			kind: entry.kind,
			level: entry.kind === "heading" ? (levels.get(entry.id) ?? null) : null,
		},
		...tocLines(entry.children, levels, depth + 1),
	]);
}

/** What the Contents sheet shows: the open document's lines, and how to reveal one of them. */
export interface ContentsView {
	lines: readonly TocLine[];
	/** Reveals node `id` in the document that opened the sheet; does nothing for an id it no longer has. */
	choose: (id: string) => void;
}

/**
 * The tables of contents open in the Contents sheet (app/contents.tsx), by a short key the
 * route takes as its one parameter, so no document content travels in a URL. The document that
 * opened a view keeps it current through live updates; the route closes it when it goes away.
 */
export class ContentsViews {
	private readonly views = new Map<string, ContentsView>();
	private readonly listeners = new Set<() => void>();
	private opened = 0;

	/** Keeps `view` and gives the key the route opens it by. */
	open(view: ContentsView): string {
		this.opened += 1;
		const key = String(this.opened);
		this.views.set(key, view);
		this.notify();
		return key;
	}

	/** Replaces an open view; does nothing once the route has closed it. */
	update(key: string, view: ContentsView): void {
		if (!this.views.has(key) || this.views.get(key) === view) return;
		this.views.set(key, view);
		this.notify();
	}

	get(key: string): ContentsView | undefined {
		return this.views.get(key);
	}

	close(key: string): void {
		if (this.views.delete(key)) this.notify();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of [...this.listeners]) listener();
	}
}

/** One set of open views for every screen. */
const ContentsViewsContext = createContext(new ContentsViews());

export function useContentsViews(): ContentsViews {
	return useContext(ContentsViewsContext);
}

/** The open view `key` names, current as its document changes, or undefined once it is gone. */
export function useContentsView(key: string): ContentsView | undefined {
	const views = useContentsViews();
	const subscribe = useCallback((listener: () => void) => views.subscribe(listener), [views]);
	return useSyncExternalStore(subscribe, () => views.get(key));
}
