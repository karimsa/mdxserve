import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import type { CodeNode } from "@mdxserve/client/document/tree-types";
import type { FlowDirection } from "@mdxserve/shared/mermaid-direction";

/** What a diagram's full screen view shows, as its block on the page last drew it. */
export interface DiagramView {
	node: CodeNode;
	/** The text handed to Mermaid: the block's, in the layout the reader chose. */
	source: string;
	/** The flowchart direction written in the source, or null for another kind of diagram. */
	authored: FlowDirection | null;
	/** The direction the reader sees, or null for another kind of diagram. */
	direction: FlowDirection | null;
	/** Lays the flowchart out another way, on the page and in the full view. */
	chooseDirection: (direction: FlowDirection) => void;
}

/**
 * The diagrams open in the full screen route (app/diagram.tsx), by a short key the route takes
 * as its one parameter, so a diagram's source never travels in a URL. The block that opened a
 * view keeps it current (a live update, a theme or layout change); the route closes it when
 * it goes away.
 */
export class DiagramViews {
	private readonly views = new Map<string, DiagramView>();
	private readonly listeners = new Set<() => void>();
	private opened = 0;

	/** Keeps `view` and gives the key the route opens it by. */
	open(view: DiagramView): string {
		this.opened += 1;
		const key = String(this.opened);
		this.views.set(key, view);
		this.notify();
		return key;
	}

	/** Replaces an open view; does nothing once the route has closed it. */
	update(key: string, view: DiagramView): void {
		if (!this.views.has(key) || this.views.get(key) === view) return;
		this.views.set(key, view);
		this.notify();
	}

	get(key: string): DiagramView | undefined {
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

/**
 * @internal Exported for its tests, which give each render views of their own. The app uses
 * the default: one set of open views for every screen.
 */
export const DiagramViewsContext = createContext(new DiagramViews());

export function useDiagramViews(): DiagramViews {
	return useContext(DiagramViewsContext);
}

/** The open view `key` names, current as its block changes, or undefined once it is gone. */
export function useDiagramView(key: string): DiagramView | undefined {
	const views = useDiagramViews();
	const subscribe = useCallback((listener: () => void) => views.subscribe(listener), [views]);
	return useSyncExternalStore(subscribe, () => views.get(key));
}
