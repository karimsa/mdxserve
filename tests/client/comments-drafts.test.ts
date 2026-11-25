import { describe, expect, it } from "vitest";
import {
	canSend,
	fieldHeight,
	replyDraftOf,
	FIELD_MAX_HEIGHT,
	FIELD_MIN_HEIGHT,
	withReplyDraft,
} from "../../client/comments/drafts";
import { layoutPins, pinLeft } from "../../client/comments/pins";

describe("reply drafts", () => {
	it("keeps text per thread and drops empty text", () => {
		let drafts = withReplyDraft({}, "a", "hello");
		drafts = withReplyDraft(drafts, "b", "world");
		expect(drafts).toEqual({ a: "hello", b: "world" });
		drafts = withReplyDraft(drafts, "a", "");
		expect(drafts).toEqual({ b: "world" });
	});

	it("returns the same object when nothing changes", () => {
		const drafts = { a: "x" };
		expect(withReplyDraft(drafts, "a", "x")).toBe(drafts);
		expect(withReplyDraft(drafts, "zzz", "")).toBe(drafts);
	});
});

describe("reply drafts for ids that name Object.prototype members", () => {
	it("treats them as ordinary thread ids", () => {
		for (const id of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
			expect(replyDraftOf({}, id)).toBe("");
			expect(withReplyDraft({}, id, "")).toEqual({});
			const drafts = withReplyDraft({}, id, "hello");
			expect(replyDraftOf(drafts, id)).toBe("hello");
			expect(replyDraftOf(withReplyDraft(drafts, id, ""), id)).toBe("");
		}
	});
});

describe("reply field", () => {
	it("grows between one line and 120px", () => {
		expect(fieldHeight(0)).toBe(FIELD_MIN_HEIGHT);
		expect(fieldHeight(24.2)).toBe(25);
		expect(fieldHeight(500)).toBe(FIELD_MAX_HEIGHT);
	});

	it("sends only with text, when writes are allowed and none is in flight", () => {
		expect(canSend("hi", false, false)).toBe(true);
		expect(canSend("  \n", false, false)).toBe(false);
		expect(canSend("hi", true, false)).toBe(false);
		expect(canSend("hi", false, true)).toBe(false);
	});
});

describe("gutter counters", () => {
	it("centres a pin on its line", () => {
		expect(layoutPins([{ id: "a", top: 100, height: 30 }], 22, 4)).toEqual([{ id: "a", top: 104 }]);
	});

	it("keeps pins apart, in top-to-bottom order", () => {
		const placed = layoutPins(
			[
				{ id: "low", top: 110, height: 22 },
				{ id: "high", top: 100, height: 22 },
				{ id: "far", top: 400, height: 22 },
			],
			22,
			4,
		);
		expect(placed.map((pin) => pin.id)).toEqual(["high", "low", "far"]);
		expect(placed[1].top - placed[0].top).toBeGreaterThanOrEqual(26);
		expect(placed[2].top).toBe(400);
	});

	it("places the pin beside the column, inside the viewport", () => {
		expect(pinLeft(800, 44, 1200)).toBe(808);
		expect(pinLeft(1190, 44, 1200)).toBe(1148);
		expect(pinLeft(0, 44, 10)).toBe(0);
	});
});

describe("pending sends", () => {
	it("adds and removes a key, and returns the same set when nothing changes", async () => {
		const { pendingReplyKey, withPendingSend } = await import("../../client/comments/state");
		const key = pendingReplyKey("/docs/a.md", "t1");
		expect(key).not.toBe(pendingReplyKey("/docs/b.md", "t1"));
		const empty: ReadonlySet<string> = new Set();
		expect(withPendingSend(empty, key, false)).toBe(empty);
		const one = withPendingSend(empty, key, true);
		expect(one.has(key)).toBe(true);
		expect(withPendingSend(one, key, true)).toBe(one);
		expect(withPendingSend(one, key, false).has(key)).toBe(false);
	});
});
