import { atomWithStorage, createJSONStorage } from "jotai/utils";

export type SortKey = "name" | "modified";

function isSortKey(value: unknown): value is SortKey {
	return value === "name" || value === "modified";
}

// The pre-jotai code stored the sort as a bare string (`modified`), which
// jotai's JSON storage can't parse. Accept both forms so an existing choice
// survives the upgrade; writes go through the JSON storage as usual.
const sortStorage = createJSONStorage<SortKey>(() => localStorage);
const legacyAwareSortStorage = {
	...sortStorage,
	getItem(key: string, initialValue: SortKey): SortKey {
		try {
			const raw = localStorage.getItem(key);
			if (raw === null) return initialValue;
			try {
				const parsed: unknown = JSON.parse(raw);
				return isSortKey(parsed) ? parsed : initialValue;
			} catch {
				return isSortKey(raw) ? raw : initialValue;
			}
		} catch {
			return initialValue;
		}
	},
};

/** Folder listing sort order. */
export const listingSortAtom = atomWithStorage<SortKey>(
	"mdxserve.listing.sort",
	"name",
	legacyAwareSortStorage,
	{ getOnInit: true },
);

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 560;
export const SIDEBAR_DEFAULT_WIDTH = 264;

/** Docked sidebar width in px; dragged via the resize handle. */
export const sidebarWidthAtom = atomWithStorage<number>(
	"mdxserve.sidebar.width",
	SIDEBAR_DEFAULT_WIDTH,
	undefined,
	{ getOnInit: true },
);

export const TOC_MIN_WIDTH = 160;
export const TOC_MAX_WIDTH = 420;
export const TOC_DEFAULT_WIDTH = 220;

/** "On this page" rail width in px; dragged via the resize handle. */
export const tocWidthAtom = atomWithStorage<number>(
	"mdxserve.toc.width",
	TOC_DEFAULT_WIDTH,
	undefined,
	{ getOnInit: true },
);

export const LISTING_MIN_WIDTH = 360;
export const LISTING_MAX_WIDTH = 1600;

/** Folder listing width in px, or null for the default prose width. */
export const listingWidthAtom = atomWithStorage<number | null>(
	"mdxserve.listing.width",
	null,
	undefined,
	{ getOnInit: true },
);

export const DOC_MIN_WIDTH = 480;
export const DOC_MAX_WIDTH = 1600;

/** Doc page width in px, or null for the default prose width. */
export const docWidthAtom = atomWithStorage<number | null>("mdxserve.doc.width", null, undefined, {
	getOnInit: true,
});
