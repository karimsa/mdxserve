import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import type { CommentActions } from "./data";
import type { CommentsModel } from "./model";

/** What the Comments sheet shows: the open document's comments state, kept current by the document. */
export interface CommentsView {
	model: CommentsModel;
	/** The comment writes; null on a restricted server, which offers none (KA14). */
	actions: CommentActions | null;
	loading: boolean;
	/** Why the threads could not be read, when they could not. */
	failure: string | null;
	onRetry(): void;
	/** The sheet went away (swiped down, or closed): the document stops showing it as open. */
	onClosed(): void;
	/** The document had no threads when the sheet opened: it opens short. */
	empty: boolean;
}

/**
 * The comments sheets open over a document (app/comments.tsx), by a short key the route takes
 * as its one parameter, so no document content travels in a URL. The document that opened a
 * view keeps it current; the route closes it when it goes away.
 */
export class CommentsViews {
	private readonly views = new Map<string, CommentsView>();
	private readonly listeners = new Set<() => void>();
	private opened = 0;

	/** Keeps `view` and gives the key the route opens it by. */
	open(view: CommentsView): string {
		this.opened += 1;
		const key = String(this.opened);
		this.views.set(key, view);
		this.notify();
		return key;
	}

	/** Replaces an open view; does nothing once the route has closed it. */
	update(key: string, view: CommentsView): void {
		if (!this.views.has(key) || this.views.get(key) === view) return;
		this.views.set(key, view);
		this.notify();
	}

	get(key: string): CommentsView | undefined {
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

/** One set of open sheets for the app; the root layout reads it to pick a sheet's first height. */
const views = new CommentsViews();
const CommentsViewsContext = createContext(views);

export function useCommentsViews(): CommentsViews {
	return useContext(CommentsViewsContext);
}

/** The open view `key` names, current as its document changes, or undefined once it is gone. */
export function useCommentsView(key: string): CommentsView | undefined {
	const store = useCommentsViews();
	const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
	return useSyncExternalStore(subscribe, () => store.get(key));
}

/**
 * The sheet's heights, as shares of the window's: short (the control and one line, for a
 * document with no threads), about half, and full. The document behind stays undimmed and
 * usable up to the half height (`UNDIMMED_DETENT`).
 */
export const SHEET_DETENTS = [0.3, 0.5, 1];
export const UNDIMMED_DETENT = 1;

/** The detent a sheet opens at: short when its document had no threads, else half height. */
export function initialDetent(key: string | undefined): number {
	return key !== undefined && views.get(key)?.empty === true ? 0 : 1;
}
