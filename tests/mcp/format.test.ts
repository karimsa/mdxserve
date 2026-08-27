import { describe, expect, it } from "vitest";
import { formatValidationResult } from "../../src/mcp/format.js";
import type { ValidationResult } from "../../src/validation/validate.js";

const base: ValidationResult = {
	ok: true,
	path: "/docs/a.md",
	diagnostics: [],
	rendered: false,
	hints: [],
};

describe("formatValidationResult — hints", () => {
	it("prints nothing extra when there are no hints", () => {
		const text = formatValidationResult(base);
		expect(text).not.toContain("hint:");
	});

	it("prints each hint as a `hint:` line after the render status, on an OK result", () => {
		const text = formatValidationResult({ ...base, hints: ["first", "second"] });
		const lines = text.split("\n");
		expect(lines[0]).toBe("OK: /docs/a.md");
		expect(lines.slice(-2)).toEqual(["hint: first", "hint: second"]);
	});

	it("keeps hints after the diagnostics on a failing result", () => {
		const text = formatValidationResult({
			...base,
			ok: false,
			diagnostics: [{ severity: "error", code: "mdx-compile", message: "boom", line: 3 }],
			hints: ["use Screenshot"],
		});
		const lines = text.split("\n");
		expect(lines[0]).toContain("boom");
		expect(lines[lines.length - 1]).toBe("hint: use Screenshot");
	});
});
