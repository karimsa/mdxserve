import { createMetadataPort } from "../helpers/metadata.js";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { escapeBareLt as escapeWithMetadata } from "../../src/rendering/mdx/lenient-md.js";

describe("escapeBareLt", () => {
	it("is idempotent", () => {
		fc.assert(
			fc.property(fc.string(), (source) => {
				const once = escapeBareLt(source);
				const twice = escapeBareLt(once);
				expect(twice).toBe(once);
			}),
		);
	});

	it("preserves line count", () => {
		fc.assert(
			fc.property(fc.string(), (source) => {
				expect(escapeBareLt(source).split("\n").length).toBe(source.split("\n").length);
			}),
		);
	});

	it("preserves recognized frontmatter exactly while escaping body prose", () => {
		fc.assert(
			fc.property(
				fc.constantFrom("", "\uFEFF"),
				fc.constantFrom("\n", "\r\n", "\r"),
				fc.integer({ min: 0, max: 999 }),
				(bom, newline, limit) => {
					const frontmatter = `${bom}---${newline}description: Value < ${limit}${newline}---${newline}`;
					const body = `Body < ${limit}${newline}`;
					expect(escapeBareLt(frontmatter + body)).toBe(
						`${frontmatter}Body \\< ${limit}${newline}`,
					);
				},
			),
		);
	});

	it("preserves a mixed-newline header and escapes CR-delimited body lines", () => {
		const header = "---\rdescription: Value < 10\n---\r\n";
		expect(escapeBareLt(`${header}Body < 10\rNext < 20`)).toBe(`${header}Body \\< 10\rNext \\< 20`);
	});

	it("escapes an unclosed frontmatter-like block as ordinary body text", () => {
		expect(escapeBareLt("---\ndescription: Value < 10\n")).toBe("---\ndescription: Value \\< 10\n");
	});

	it("preserves nested and multiline MDX expressions while escaping neighboring prose", () => {
		const expression = [
			"{(() => {",
			'  const label = "}";',
			"  return [1, 2].filter(",
			"    (value) => value < 10",
			"  ).map((value) => `${label}${value}`).join(',');",
			"})()}",
		].join("\n");
		expect(escapeBareLt(`${expression}\nWidth < 10\n`)).toBe(`${expression}\nWidth \\< 10\n`);
	});

	it("preserves comparisons after regex braces inside an MDX expression", () => {
		const expression = "{ /}/.test(value) && count < 10 }";
		expect(escapeBareLt(`${expression}\nWidth < 10`)).toBe(`${expression}\nWidth \\< 10`);
	});

	it("escapes prose after an unmatched backtick", () => {
		expect(escapeBareLt("An unmatched ` marker\nWidth < 10")).toBe(
			"An unmatched ` marker\nWidth \\< 10",
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

function escapeBareLt(source: string): string {
	return escapeWithMetadata(source, createMetadataPort());
}
