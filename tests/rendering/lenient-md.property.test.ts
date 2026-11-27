import { createMetadataPort } from "../helpers/metadata.js";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";
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

	it("leaves a quoted value unchanged when there is whitespace around the equals sign", () => {
		expect(escapeBareLt('<Callout title = "Latency < 100 ms">under < 5 ms</Callout>')).toBe(
			'<Callout title = "Latency < 100 ms">under \\< 5 ms</Callout>',
		);
	});

	it("leaves attribute values unchanged when the tag spans several lines", () => {
		const source = [
			"<Callout",
			'  title="Latency < 100 ms"',
			"      tone='a <= b'",
			"  data={[1, 2].filter((value) => value < 2)}",
			">",
			"under < 5 ms",
			"</Callout>",
		].join("\n");
		expect(escapeBareLt(source)).toBe(source.replace("under < 5", "under \\< 5"));
	});

	it("stops treating an unclosed `<word` in prose as a tag at the next blank line", () => {
		expect(escapeBareLt("a <b c\n\nx < 5")).toBe("a <b c\n\nx \\< 5");
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

describe("escapeBareLt scanner states", () => {
	it("does not start a tag at an escaped `<` and still escapes the comparison after it", () => {
		expect(escapeBareLt("Write \\<Widget when x < 5.")).toBe("Write \\<Widget when x \\< 5.");
	});

	it("treats `\\\\<` as an escaped backslash followed by a real `<`", () => {
		expect(escapeBareLt("a \\\\< 5")).toBe("a \\\\\\< 5");
		expect(escapeBareLt("a \\\\<b c> x < 5")).toBe("a \\\\<b c> x \\< 5");
	});

	it("keeps a backslash literal inside a plain attribute string", () => {
		// `title="a\"` ends at the second quote, so the `>` closes the tag.
		expect(escapeBareLt('<Callout title="a\\">x < 5</Callout>')).toBe(
			'<Callout title="a\\">x \\< 5</Callout>',
		);
		expect(escapeBareLt("<Callout title='a\\'>x < 5</Callout>")).toBe(
			"<Callout title='a\\'>x \\< 5</Callout>",
		);
	});

	it("honours backslash escapes in JavaScript strings inside braces", () => {
		expect(escapeBareLt("<Callout title={'can\\'t'}>x < 5</Callout>")).toBe(
			"<Callout title={'can\\'t'}>x \\< 5</Callout>",
		);
		expect(escapeBareLt('<Callout title={"say \\"a > b\\""}>x < 5</Callout>')).toBe(
			'<Callout title={"say \\"a > b\\""}>x \\< 5</Callout>',
		);
		expect(escapeBareLt("<Callout title={'a\\\\'}>x < 5</Callout>")).toBe(
			"<Callout title={'a\\\\'}>x \\< 5</Callout>",
		);
	});

	it("reads template literals, including `${}` substitutions and nested braces", () => {
		expect(
			escapeBareLt(
				"<Callout title={`a > ${1 < 2 ? 'x}' : `y${{ a: 1 }.a}`} \\` b`}>x < 5</Callout>",
			),
		).toBe("<Callout title={`a > ${1 < 2 ? 'x}' : `y${{ a: 1 }.a}`} \\` b`}>x \\< 5</Callout>");
	});

	it("skips JavaScript comments inside braces, including an apostrophe in one", () => {
		expect(escapeBareLt("<Callout title={/* user's label */ 'Note'}>x < 5</Callout>")).toBe(
			"<Callout title={/* user's label */ 'Note'}>x \\< 5</Callout>",
		);
		const source = [
			"<Callout",
			"  data={{ a: 1, // it's }",
			"  b: '/*' /* a",
			"  don't */ }}",
			">",
			"x < 5",
		].join("\n");
		expect(escapeBareLt(source)).toBe(source.replace("x < 5", "x \\< 5"));
	});

	it("keeps an inline code span that crosses a line from starting a tag", () => {
		expect(escapeBareLt("`<Widget\nexample` and x < 5")).toBe("`<Widget\nexample` and x \\< 5");
		expect(escapeBareLt("``a <W\nb`` c < 1")).toBe("``a <W\nb`` c \\< 1");
	});

	it("keeps a multiline MDX comment from starting a tag", () => {
		expect(escapeBareLt("{/*\nExample: <Widget\n\nmore\n*/}\nx < 5")).toBe(
			"{/*\nExample: <Widget\n\nmore\n*/}\nx \\< 5",
		);
		expect(escapeBareLt("{/* a\n*/} x < 5")).toBe("{/* a\n*/} x \\< 5");
	});

	it("leaves a reference definition and its title alone", () => {
		expect(escapeBareLt('[ref]: https://example.com "<Widget"\nx < 5\n\n[ref]')).toBe(
			'[ref]: https://example.com "<Widget"\nx \\< 5\n\n[ref]',
		);
	});

	it("handles a one-line MDX comment that holds a brace, and a definition-like prose line", () => {
		expect(escapeBareLt("{/* { */}\nx < 5")).toBe("{/* { */}\nx \\< 5");
		expect(escapeBareLt("[note]: x < 5")).toBe("[note]: x \\< 5");
	});

	it("closes a code span before recognising a definition-like line, and stays linear", () => {
		expect(escapeBareLt('`start\n[ref]: a "end`\nx < 5')).toBe('`start\n[ref]: a "end`\nx \\< 5');
		const source = "`some code\nmore code` text\n".repeat(20_000);
		const started = Date.now();
		expect(escapeBareLt(source)).toBe(source);
		expect(Date.now() - started).toBeLessThan(2000);
	});

	it("scans prose expressions as JavaScript: nested braces, strings and spaced comment ends", () => {
		expect(escapeBareLt("{['<Widget', {}]} and x < 5")).toBe("{['<Widget', {}]} and x \\< 5");
		expect(escapeBareLt("{/*\nA comment\n*/ }\nx < 5")).toBe("{/*\nA comment\n*/ }\nx \\< 5");
		expect(escapeBareLt("{/* x < 1 */} y < 2")).toBe("{/* x < 1 */} y \\< 2");
	});

	it("only skips a link target that is a valid link", () => {
		expect(escapeBareLt("](x < 5)")).toBe("](x \\< 5)");
		expect(escapeBareLt("[label](x < 5)")).toBe("[label](x \\< 5)");
	});

	it("does not continue a code span across a heading, fence or rule", () => {
		expect(escapeBareLt("`start\n# x < 5\nend`")).toBe("`start\n# x \\< 5\nend`");
		expect(escapeBareLt("`start\n---\nx < 5\nend`")).toBe("`start\n---\nx \\< 5\nend`");
	});

	it("closes a code span that ends on an indented continuation line", () => {
		expect(escapeBareLt("`start\n    end`\ny < 6")).toBe("`start\n    end`\ny \\< 6");
	});

	it("treats an unmatched backtick as plain text", () => {
		expect(escapeBareLt("it`s x < 5\nand y < 6")).toBe("it`s x \\< 5\nand y \\< 6");
		expect(escapeBareLt("`a\n\nx < 5 `b`")).toBe("`a\n\nx \\< 5 `b`");
	});

	it("does not read a Markdown link or image title as a tag", () => {
		expect(escapeBareLt('[link](https://example.com "<Widget") and x < 5')).toBe(
			'[link](https://example.com "<Widget") and x \\< 5',
		);
		expect(escapeBareLt('![alt](a.png "<img") and x < 5')).toBe('![alt](a.png "<img") and x \\< 5');
	});

	it("carries brace, string and template state across lines", () => {
		const source = [
			"<Callout",
			"  title={`a >",
			"b < 1`}",
			"  data={{ a: '}' }}",
			">",
			"x < 5",
		].join("\n");
		expect(escapeBareLt(source)).toBe(source.replace("x < 5", "x \\< 5"));
	});

	it("leaves indented code, fenced code and frontmatter alone", () => {
		expect(escapeBareLt("para\n\n    a < b\n")).toBe("para\n\n    a < b\n");
		expect(escapeBareLt("```\na < b\n```\n")).toBe("```\na < b\n```\n");
		expect(escapeBareLt("---\ntitle: a < b\n---\nx < 5")).toBe("---\ntitle: a < b\n---\nx \\< 5");
	});

	const cases = [
		"`<Widget\nexample` and x < 5",
		'[link](https://example.com "<Widget") and x < 5',
		"<Callout title={/* user's label */ 'Note'}>x < 5</Callout>",
		"Write \\<Widget when x < 5.",
		"a \\\\< 5 and more",
		'<Callout title="a\\">x < 5</Callout>',
		"<Callout title='a\\'>x < 5</Callout>",
		"<Callout title={'can\\'t'}>x < 5</Callout>",
		'<Callout title={"say \\"a > b\\""}>x < 5</Callout>',
		"<Callout title={`a > ${1 < 2 ? 'x' : 'y'} b`}>x < 5</Callout>",
		'<Callout title="Latency < 100 ms">x < 5</Callout>',
	];

	for (const extension of ["md", "mdx"]) {
		it(`parses every tricky input without a syntax error in .${extension}`, async () => {
			for (const body of cases) {
				const result = await validateSource({
					metadata: createMetadataPort(),
					source: `# Title\n\n${body}\n`,
					path: `doc.${extension}`,
					registry: fixtureRegistry,
				});
				expect(result.diagnostics.some((diagnostic) => diagnostic.code === "mdx-syntax")).toBe(
					false,
				);
			}
		});
	}

	it("delivers attribute values to the parser unchanged", () => {
		const attributeOf = (body: string): unknown => {
			const tree = unified().use(remarkParse).use(remarkMdx).parse(escapeBareLt(body));
			const paragraph = tree.children[0] as { children: unknown[] };
			const node = paragraph.children[0] as { attributes: Array<{ value: unknown }> };
			return node.attributes[0].value;
		};
		expect(attributeOf('<Callout title="a\\">x < 5</Callout>')).toBe("a\\");
		expect(attributeOf("<Callout title='Latency < 100 \\ms'>x</Callout>")).toBe(
			"Latency < 100 \\ms",
		);
		const expression = attributeOf("<Callout title={'can\\'t'}>x < 5</Callout>") as {
			value: string;
		};
		expect(expression.value).toBe("'can\\'t'");
	});

	it("never leaves a bare `<` before a digit, space or `=` in tag-free prose", () => {
		const pieceArb = fc.constantFrom(" ", "5", "=", "<", "\\<", "\\\\<", "\\\\");
		fc.assert(
			fc.property(fc.array(pieceArb, { maxLength: 12 }), (pieces) => {
				const output = escapeBareLt("x" + pieces.join(""));
				expect(output).toBe(escapeBareLt(output));
				// A real `<` is one preceded by an even run of backslashes.
				expect(/(?<!\\)(?:\\\\)*<[\d\s=]/.test(output)).toBe(false);
			}),
		);
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
		.map((parts) => "p " + parts.join(" "));

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
				expect(md.diagnostics.some((diagnostic) => diagnostic.code === "mdx-syntax")).toBe(false);
			}),
			{ numRuns: 25 },
		);
	});
});

function escapeBareLt(source: string): string {
	return escapeWithMetadata(source, createMetadataPort());
}
