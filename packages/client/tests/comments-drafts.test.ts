import { describe, expect, it } from "vitest";
import { canSend, replyDraftOf, withReplyDraft } from "../comments/drafts";
import { relativeTime } from "../comments/time";

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

describe("canSend", () => {
	it("sends only with text, when writes are allowed and none is in flight", () => {
		expect(canSend("hi", false, false)).toBe(true);
		expect(canSend("  \n", false, false)).toBe(false);
		expect(canSend("hi", true, false)).toBe(false);
		expect(canSend("hi", false, true)).toBe(false);
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
