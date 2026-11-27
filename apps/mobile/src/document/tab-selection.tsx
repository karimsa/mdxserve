import { createContext, use, useState, useSyncExternalStore } from "react";

/**
 * Which tab each `Tabs` of the open document shows, by the `Tabs` node's id. The document
 * screen owns one, so a heading link, the table of contents or a search result can select the
 * tabs on the way to a node before scrolling to it, as `revealNode` does on the web.
 */
export interface TabSelection {
	get(tabsId: string): string | undefined;
	/** True when this changed what the `Tabs` shows. */
	select(tabsId: string, value: string): boolean;
	subscribe(listener: () => void): () => void;
}

export function createTabSelection(): TabSelection {
	const selected = new Map<string, string>();
	const listeners = new Set<() => void>();
	return {
		get: (tabsId) => selected.get(tabsId),
		select(tabsId, value) {
			if (selected.get(tabsId) === value) return false;
			selected.set(tabsId, value);
			for (const listener of [...listeners]) listener();
			return true;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export const TabSelectionContext = createContext<TabSelection | null>(null);

/**
 * The tab a `Tabs` shows and how to change it: the screen's selection when there is one, else
 * a selection of this `Tabs` alone (the gallery's sample document).
 */
export function useSelectedTab(tabsId: string, initial: string): [string, (value: string) => void] {
	const shared = use(TabSelectionContext);
	const [own] = useState(createTabSelection);
	const selection = shared ?? own;
	const value = useSyncExternalStore(selection.subscribe, () => selection.get(tabsId));
	return [value ?? initial, (next) => void selection.select(tabsId, next)];
}
