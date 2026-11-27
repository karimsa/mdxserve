/**
 * How a folder listing is ordered, in the web client and the app alike: folders first, then
 * by name, or by last modified (newest first, then by name).
 */
export type ListingSortKey = "name" | "modified";

/** The orders a reader can choose, with the labels both clients show. */
export const LISTING_SORT_OPTIONS: ReadonlyArray<{ value: ListingSortKey; label: string }> = [
	{ value: "name", label: "Name" },
	{ value: "modified", label: "Last modified" },
];

export const DEFAULT_LISTING_SORT: ListingSortKey = "name";

/** Where each client keeps the reader's choice (browser storage, device storage). */
export const LISTING_SORT_STORAGE_KEY = "mdxserve.listing.sort";

export function isListingSortKey(value: unknown): value is ListingSortKey {
	return value === "name" || value === "modified";
}

interface SortableEntry {
	name: string;
	isDir: boolean;
	mtime?: number;
}

export function sortListingEntries<Entry extends SortableEntry>(
	entries: readonly Entry[],
	sort: ListingSortKey,
): Entry[] {
	const byName = (first: Entry, second: Entry) =>
		first.name.localeCompare(second.name, undefined, { sensitivity: "base" });
	return [...entries].sort((first, second) => {
		if (first.isDir !== second.isDir) return first.isDir ? -1 : 1;
		if (sort === "modified") {
			const diff = (second.mtime ?? 0) - (first.mtime ?? 0);
			if (diff !== 0) return diff;
		}
		return byName(first, second);
	});
}
