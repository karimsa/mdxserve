import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import { HALF_DETENT, SHORT_DETENT } from "../glass-sheet";
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

/** The height a comments sheet opens at: short when its document had no threads, else half. */
export function initialDetent(key: string | undefined): number {
	return key !== undefined && views.get(key)?.empty === true ? SHORT_DETENT : HALF_DETENT;
}
