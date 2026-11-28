import { describe, expect, it } from "vitest";
import { isSelfWrite, markSelfWrite, SELF_WRITE_WINDOW_MS } from "../src/comments/self-writes";

describe("self writes", () => {
	it("holds a path for two seconds", () => {
		markSelfWrite("/a.md", 1000);
		expect(isSelfWrite("/a.md", 1000 + SELF_WRITE_WINDOW_MS - 1)).toBe(true);
		expect(isSelfWrite("/a.md", 1000 + SELF_WRITE_WINDOW_MS)).toBe(false);
		expect(isSelfWrite("/b.md", 1000)).toBe(false);
	});
});
