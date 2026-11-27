import { describe, expect, it } from "vitest";
import { isSelfWrite, markSelfWrite, SELF_WRITE_WINDOW_MS } from "../src/comments/self-writes";
import { relativeTime } from "../src/comments/time";

describe("self writes", () => {
	it("holds a path for two seconds", () => {
		markSelfWrite("/a.md", 1000);
		expect(isSelfWrite("/a.md", 1000 + SELF_WRITE_WINDOW_MS - 1)).toBe(true);
		expect(isSelfWrite("/a.md", 1000 + SELF_WRITE_WINDOW_MS)).toBe(false);
		expect(isSelfWrite("/b.md", 1000)).toBe(false);
	});
});

describe("relativeTime", () => {
	const now = Date.parse("2026-11-24T20:00:00.000Z");
	it("formats recent and older times", () => {
		expect(relativeTime("2026-11-24T19:59:50.000Z", now)).toBe("now");
		expect(relativeTime("2026-11-24T19:55:00.000Z", now)).toBe("5m");
		expect(relativeTime("2026-11-24T17:00:00.000Z", now)).toBe("3h");
		expect(relativeTime("2026-11-23T20:00:00.000Z", now)).toBe("1d");
	});
	it("returns empty for missing or invalid input", () => {
		expect(relativeTime(undefined, now)).toBe("");
		expect(relativeTime("nope", now)).toBe("");
	});
});
