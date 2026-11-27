import { describe, expect, it } from "vitest";
import { hasUnsavedInput, staleBuildAction } from "../../client/stale-build";

describe("staleBuildAction", () => {
	it("reloads when a chunk fails to load and nothing is being edited", () => {
		expect(staleBuildAction(false, null, 1_000_000)).toBe("reload");
	});

	it("asks instead of reloading while an editor is open, so unsaved text is kept", () => {
		expect(staleBuildAction(true, null, 1_000_000)).toBe("ask");
	});

	it("asks instead of reloading twice within 30 seconds, so a broken build cannot loop", () => {
		expect(staleBuildAction(false, 1_000_000, 1_029_999)).toBe("ask");
		expect(staleBuildAction(false, 1_000_000, 1_030_000)).toBe("reload");
	});
});

describe("hasUnsavedInput", () => {
	/** A stand-in for the document: elements matching the first selector, and its textareas. */
	function page(matches: boolean, drafts: string[]): ParentNode {
		return {
			querySelector: () => (matches ? {} : null),
			querySelectorAll: () => drafts.map((value) => ({ value })),
		} as unknown as ParentNode;
	}

	it("is false for a page with nothing open and empty text fields", () => {
		expect(hasUnsavedInput(page(false, []))).toBe(false);
		expect(hasUnsavedInput(page(false, ["", "  "]))).toBe(false);
	});

	it("is true for an open editor or dialog", () => {
		expect(hasUnsavedInput(page(true, []))).toBe(true);
	});

	it("is true for an unsent comment draft", () => {
		expect(hasUnsavedInput(page(false, ["", "Looks good"]))).toBe(true);
	});
});
