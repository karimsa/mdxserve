import { describe, expect, it } from "vitest";
import { introducedErrors } from "../../src/validation/introduced.js";
import type { Diagnostic } from "../../src/validation/validate.js";

function error(code: Diagnostic["code"], message: string, line?: number): Diagnostic {
	return { severity: "error", code, message, line };
}

describe("introducedErrors", () => {
	it("is empty when nothing changed", () => {
		const diagnostics = [error("missing-id", "Add id to <Tabs>", 3)];
		expect(introducedErrors(diagnostics, diagnostics)).toEqual([]);
	});

	it("returns an error the file did not have", () => {
		const added = error("unknown-component", "Unknown component Calout", 4);
		expect(introducedErrors([], [added])).toEqual([added]);
	});

	it("returns an mdx-syntax error the edit introduced when the file had none", () => {
		const added = error(
			"mdx-syntax",
			"Could not parse expression. The section starting on line 3 is shown as source until this is fixed. Fix the syntax at line 5.",
			5,
		);
		expect(introducedErrors([], [added])).toEqual([added]);
	});

	it("allows an mdx-syntax error that stays in another section, even when it moves", () => {
		const before = error(
			"mdx-syntax",
			"Could not parse expression. The section starting on line 12 is shown as source until this is fixed. Fix the syntax at line 14.",
			14,
		);
		const after = error(
			"mdx-syntax",
			"Could not parse expression. The section starting on line 15 is shown as source until this is fixed. Fix the syntax at line 17.",
			17,
		);
		expect(introducedErrors([before], [after])).toEqual([]);
	});

	it("ignores the line field and compares the message with line numbers normalized", () => {
		const before = error("duplicate-heading", "Heading repeats; first on line 12", 20);
		const after = error("duplicate-heading", "Heading repeats; first on line 30", 2);
		expect(introducedErrors([before], [after])).toEqual([]);
	});

	it.each([
		["Lines 3, 5 have a problem", "Lines 40, 52, 61 have a problem"],
		["See line 4-9 for details", "See line 10-19 for details"],
		["Seen on LINE 7.", "Seen on line 99."],
	])("normalizes %j and %j to the same key", (first, second) => {
		expect(introducedErrors([error("invalid-id", first)], [error("invalid-id", second)])).toEqual(
			[],
		);
	});

	it("treats a different code or different non-line text as a different error", () => {
		const before = error("invalid-id", "bad id on line 3");
		expect(introducedErrors([before], [error("duplicate-id", "bad id on line 3")])).toHaveLength(1);
		expect(introducedErrors([before], [error("invalid-id", "other id on line 3")])).toHaveLength(1);
	});

	it("counts as a multiset: a second copy of an existing error is new", () => {
		const existing = error("missing-id", "Add id to <Tabs>", 3);
		const copy = error("missing-id", "Add id to <Tabs>", 9);
		expect(introducedErrors([existing], [existing, copy])).toEqual([copy]);
		expect(introducedErrors([existing, copy], [copy])).toEqual([]);
	});

	it("never reports warnings, and warnings in before do not hide errors", () => {
		const warning: Diagnostic = { severity: "warning", code: "unknown-prop", message: "careful" };
		const added = error("unknown-component", "Unknown component Calout");
		expect(introducedErrors([], [warning])).toEqual([]);
		expect(introducedErrors([{ ...warning }], [added, warning])).toEqual([added]);
		expect(introducedErrors([{ ...added, severity: "warning" }], [added])).toEqual([added]);
	});
});
