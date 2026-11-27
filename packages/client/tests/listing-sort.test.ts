import { describe, expect, it } from "vitest";
import { DEFAULT_LISTING_SORT, isListingSortKey, sortListingEntries } from "../listing-sort";

const ENTRIES = [
	{ name: "b.md", isDir: false, mtime: 300 },
	{ name: "Zeta", isDir: true, mtime: 100 },
	{ name: "a.md", isDir: false, mtime: 100 },
	{ name: "alpha", isDir: true, mtime: 500 },
	{ name: "C.md", isDir: false, mtime: 300 },
];

describe("sortListingEntries", () => {
	it("puts folders first, then sorts by name without regard to case", () => {
		expect(sortListingEntries(ENTRIES, "name").map((entry) => entry.name)).toEqual([
			"alpha",
			"Zeta",
			"a.md",
			"b.md",
			"C.md",
		]);
	});

	it("puts folders first, then the newest, and breaks ties by name", () => {
		expect(sortListingEntries(ENTRIES, "modified").map((entry) => entry.name)).toEqual([
			"alpha",
			"Zeta",
			"b.md",
			"C.md",
			"a.md",
		]);
	});

	it("leaves the input alone", () => {
		const copy = [...ENTRIES];
		sortListingEntries(ENTRIES, "modified");
		expect(ENTRIES).toEqual(copy);
	});
});

describe("isListingSortKey", () => {
	it("accepts the two orders and the default is one of them", () => {
		expect(isListingSortKey("name")).toBe(true);
		expect(isListingSortKey("modified")).toBe(true);
		expect(isListingSortKey("size")).toBe(false);
		expect(isListingSortKey(DEFAULT_LISTING_SORT)).toBe(true);
	});
});
