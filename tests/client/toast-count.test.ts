import { describe, expect, it } from "vitest";
import { nextCount } from "../../client/ui/toast-count.js";

describe("nextCount", () => {
	it("increments a repeat push on a live id", () => {
		const live = new Set(["reload:a"]);
		const counts = new Map([["reload:a", 1]]);
		expect(nextCount(live, counts, "reload:a")).toBe(2);
		expect(counts.get("reload:a")).toBe(2);
	});

	it("starts an unseen id at 1", () => {
		const live = new Set(["reload:a"]);
		const counts = new Map<string, number>();
		expect(nextCount(live, counts, "reload:a")).toBe(1);
		expect(counts.get("reload:a")).toBe(1);
	});

	it("resets to 1 for an id that is counted but no longer live", () => {
		const live = new Set<string>();
		const counts = new Map([["reload:a", 3]]);
		expect(nextCount(live, counts, "reload:a")).toBe(1);
		expect(counts.get("reload:a")).toBe(1);
	});

	it("prunes ids absent from live", () => {
		const live = new Set(["reload:a"]);
		const counts = new Map([
			["reload:a", 2],
			["reload:b", 5],
		]);
		nextCount(live, counts, "reload:a");
		expect(counts.has("reload:b")).toBe(false);
	});

	it("keeps ids present in live", () => {
		const live = new Set(["reload:a", "reload:b"]);
		const counts = new Map([
			["reload:a", 2],
			["reload:b", 5],
		]);
		nextCount(live, counts, "reload:a");
		expect(counts.get("reload:b")).toBe(5);
	});
});
