import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import {
	DEFAULT_LISTING_SORT,
	isListingSortKey as isSortKey,
	LISTING_SORT_STORAGE_KEY,
	type ListingSortKey,
} from "@mdxserve/client/listing-sort";

export type SortKey = ListingSortKey;

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
	LISTING_SORT_STORAGE_KEY,
	DEFAULT_LISTING_SORT,
	legacyAwareSortStorage,
	{ getOnInit: true },
);

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 560;
const SIDEBAR_DEFAULT_WIDTH = 264;

/** Docked sidebar width in px; dragged via the resize handle. */
export const sidebarWidthAtom = atomWithStorage<number>(
	"mdxserve.sidebar.width",
	SIDEBAR_DEFAULT_WIDTH,
	undefined,
	{ getOnInit: true },
);

export const TOC_MIN_WIDTH = 160;
export const TOC_MAX_WIDTH = 420;
const TOC_DEFAULT_WIDTH = 220;

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

/**
 * The key (`${path}:${id}`) of the document node currently in edit mode, or
 * null. Plain in-memory atom, not persisted, since an open editor holding
 * unsaved edits should never survive a reload. Only one node edits at a time:
 * a node that isn't this atom's value drops back to read mode, discarding
 * whatever it had open (see apps/web/src/MdSection.tsx).
 */
export const openSectionAtom = atom<string | null>(null);

export type ContentLayout = "flexible" | "full-width";

/** Content layout preference; saved widths are retained when full width is active. */
export const contentLayoutAtom = atomWithStorage<ContentLayout>(
	"mdxserve.content.layout",
	"flexible",
	undefined,
	{ getOnInit: true },
);

/**
 * Where the "On this page" navigation lives:
 * - `auto`: on the right on laptop-sized screens and up, `hidden` below that.
 * - `hidden`: off the page, behind a top-bar button that brings it out.
 * - `right`: the rail beside the doc, wherever there is room for one.
 * - `above`: inline, between the doc's title and its content.
 * - `disabled`: no table of contents at all.
 */
export type TocMode = "auto" | "hidden" | "right" | "above" | "disabled";

/** @internal Exported for its tests. */
export const TOC_MODES: readonly TocMode[] = ["auto", "hidden", "right", "above", "disabled"];

function isTocMode(value: unknown): value is TocMode {
	return TOC_MODES.includes(value as TocMode);
}

/** The boolean this preference used to be: `false` meant no table of contents. */
const LEGACY_TOC_VISIBLE_KEY = "mdxserve.toc.visible";

const TOC_MODE_KEY = "mdxserve.toc.mode";

/**
 * The saved mode, falling back to what the old boolean setting meant, then to `fallback`.
 * @internal Exported for its tests.
 */
export function readTocMode(storage: Pick<Storage, "getItem">, fallback: TocMode): TocMode {
	try {
		const raw = storage.getItem(TOC_MODE_KEY);
		if (raw !== null) {
			const parsed: unknown = JSON.parse(raw);
			return isTocMode(parsed) ? parsed : fallback;
		}
		// Someone who had turned the table of contents off keeps it off.
		return storage.getItem(LEGACY_TOC_VISIBLE_KEY) === "false" ? "disabled" : fallback;
	} catch {
		return fallback;
	}
}

const tocModeStorage = createJSONStorage<TocMode>(() => localStorage);
const legacyAwareTocModeStorage = {
	...tocModeStorage,
	getItem(_key: string, initialValue: TocMode): TocMode {
		try {
			return readTocMode(localStorage, initialValue);
		} catch {
			return initialValue;
		}
	},
};

export const tocModeAtom = atomWithStorage<TocMode>(
	TOC_MODE_KEY,
	"auto",
	legacyAwareTocModeStorage,
	{ getOnInit: true },
);

/** What the open section editor offers the touch action bar (apps/web/src/EditorActionBar.tsx). */
export interface SectionEditorActions {
	save: () => void;
	cancel: () => void;
	saving: boolean;
}

/** Set by the section editor while it is open; null otherwise. Not persisted. */
export const sectionEditorActionsAtom = atom<SectionEditorActions | null>(null);
