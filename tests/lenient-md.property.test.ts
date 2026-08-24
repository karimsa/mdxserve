import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { escapeBareLt } from "../src/lenient-md.js";

describe("escapeBareLt", () => {
	it("is idempotent", () => {
		fc.assert(
			fc.property(fc.string(), (s) => {
				const once = escapeBareLt(s);
				const twice = escapeBareLt(once);
				expect(twice).toBe(once);
			}),
		);
	});

	it("preserves line count", () => {
		fc.assert(
			fc.property(fc.string(), (s) => {
				expect(escapeBareLt(s).split("\n").length).toBe(s.split("\n").length);
			}),
		);
	});

	// A bare `<` followed by a digit, whitespace, or `=` is exactly what
	// escapeBareLt targets outside of code — use it inside fences/inline code
	// to prove those regions are left alone.
	const bareLtFragment = fc.constantFrom("<1", "<9", "< ", "<\t", "<=", "<12x", "a<0b");
	const safeText = fc.stringMatching(/^[A-Za-z0-9 ]*$/);

	it("leaves text inside fenced code blocks unchanged", () => {
		fc.assert(
			fc.property(
				fc.array(bareLtFragment, { minLength: 1, maxLength: 3 }),
				safeText,
				safeText,
				(frags, before, after) => {
					const fenceContent = frags.join(" ");
					const doc = [before, "```", fenceContent, "```", after].join("\n");
					const result = escapeBareLt(doc);
					expect(result.split("\n")[2]).toBe(fenceContent);
				},
			),
		);
	});

	it("leaves text inside inline code spans unchanged", () => {
		fc.assert(
			fc.property(
				fc.array(bareLtFragment, { minLength: 1, maxLength: 3 }),
				safeText,
				safeText,
				(frags, before, after) => {
					const codeContent = frags.join(" ");
					const line = `${before} \`${codeContent}\` ${after}`;
					const result = escapeBareLt(line);
					expect(result).toContain("`" + codeContent + "`");
				},
			),
		);
	});
});
