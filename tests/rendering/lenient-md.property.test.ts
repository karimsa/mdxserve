import { createMetadataPort } from "../helpers/metadata.js";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { escapeBareLt as escapeWithMetadata } from "../../src/document/lenient.js";
import { validateSource } from "../../src/validation/validate.js";
import { fixtureRegistry } from "../fixtures/registry.js";

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

describe("escapeBareLt and JSX attributes", () => {
	it("leaves a quoted attribute value unchanged and still escapes prose on the same line", () => {
		expect(escapeBareLt('<Callout title="Latency < 100 ms">under < 5 ms</Callout>')).toBe(
			'<Callout title="Latency < 100 ms">under \\< 5 ms</Callout>',
		);
		expect(escapeBareLt("<img alt='a <= b' src=\"x.png\" /> and 3 < 4")).toBe(
			"<img alt='a <= b' src=\"x.png\" /> and 3 \\< 4",
		);
	});

	it("still escapes a quoted comparison in prose, outside any tag", () => {
		expect(escapeBareLt('He wrote "x < 5" twice')).toBe('He wrote "x \\< 5" twice');
	});

	it("validates a builtin whose attribute holds a bare `<` in both extensions, keeping the value", async () => {
		for (const extension of ["md", "mdx"]) {
			const result = await validateSource({
				metadata: createMetadataPort(),
				source: '# Title\n\n<Callout title="Latency < 100 ms">Body</Callout>\n',
				path: `doc.${extension}`,
				registry: fixtureRegistry,
			});
			expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual(
				[],
			);
		}
	});
});

describe("escapeBareLt applies to both extensions", () => {
	const proseArb = fc
		.array(
			fc.oneof(
				fc.stringMatching(/^[A-Za-z0-9 ]{1,8}$/),
				fc.constantFrom("<1", "< ", "<=", "(<800px)"),
			),
			{
				minLength: 1,
				maxLength: 6,
			},
		)
		.map((parts) => parts.join(" "));

	it("validates prose with a bare `<` the same way as .md and .mdx, with no syntax error", async () => {
		await fc.assert(
			fc.asyncProperty(proseArb, async (prose) => {
				const source = `# Title\n\n${prose}\n`;
				const [md, mdx] = await Promise.all(
					["md", "mdx"].map((extension) =>
						validateSource({
							metadata: createMetadataPort(),
							source,
							path: `doc.${extension}`,
							registry: fixtureRegistry,
						}),
					),
				);
				expect(md.diagnostics).toEqual(mdx.diagnostics);
				expect(md.diagnostics.some((diagnostic) => diagnostic.code === "mdx-compile")).toBe(false);
			}),
			{ numRuns: 25 },
		);
	});
});

function escapeBareLt(source: string): string {
	return escapeWithMetadata(source, createMetadataPort());
}
