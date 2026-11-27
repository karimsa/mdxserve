import { atom, getDefaultStore } from "jotai";

/**
 * The selected tab of every `Tabs` the reader has switched, keyed by
 * `tabSelectionKey(documentPath, tabsId)`. A `Tabs` with no entry shows its
 * default. In memory only: it outlives a refetch of the document (the Tabs
 * keeps its id), not a reload.
 */
export const tabSelectionAtom = atom<Readonly<Record<string, string>>>({});

export function tabSelectionKey(documentPath: string, tabsId: string): string {
	return `${documentPath}\u0000${tabsId}`;
}

/** Select `value` in each listed `Tabs` of `documentPath` at once. */
export function selectTabs(
	documentPath: string,
	steps: readonly { tabsId: string; value: string }[],
): boolean {
	const store = getDefaultStore();
	const current = store.get(tabSelectionAtom);
	let changed = false;
	const next: Record<string, string> = { ...current };
	for (const step of steps) {
		const key = tabSelectionKey(documentPath, step.tabsId);
		if (next[key] === step.value) continue;
		next[key] = step.value;
		changed = true;
	}
	if (changed) store.set(tabSelectionAtom, next);
	return changed;
}
