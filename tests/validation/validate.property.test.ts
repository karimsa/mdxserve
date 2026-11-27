import { createMetadataPort } from "../helpers/metadata.js";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { mdxjs } from "micromark-extension-mdxjs";
import { analyzeTree, collectHints, validateSource } from "../../src/validation/validate.js";
import { fixtureComponentNames, fixtureRegistry } from "../fixtures/registry.js";
import { restrictTree, type RestrictDiagnostic } from "../../src/document/restrict.js";
import { DocumentService } from "../../src/document/service.js";
import { CHART_DIAGRAM_KEYWORDS, type ChartDiagramKeyword } from "../../client/mermaid-chart.js";

// Same parse helper as src/docs/doc-cache.ts.
function parse(src: string) {
	return fromMarkdown(src, { extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown()] });
}

// ---- GFM-only document generator --------------------------------------
// ATX headings, plain-word paragraphs, "-" lists, task list items, simple
// pipe tables, and fenced code blocks. Deliberately never contains a bare
// `<` or `{` outside of a fence, so it always compiles as valid MDX.

const words = fc
	.array(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 6 })
	.map((chosen) => chosen.join(" "));

const headingArb = fc
	.tuple(fc.integer({ min: 1, max: 6 }), words)
	.map(([level, text]) => `${"#".repeat(level)} ${text}`);

const paragraphArb = words;

const listArb = fc
	.array(words, { minLength: 1, maxLength: 4 })
	.map((items) => items.map((item) => `- ${item}`).join("\n"));

const taskListArb = fc
	.array(fc.tuple(fc.boolean(), words), { minLength: 1, maxLength: 4 })
	.map((items) => items.map(([checked, text]) => `- [${checked ? "x" : " "}] ${text}`).join("\n"));

const cellArb = fc.stringMatching(/^[a-z]{1,8}$/);
const tableArb = fc
	.array(fc.tuple(cellArb, cellArb), { minLength: 1, maxLength: 3 })
	.map((rows) => {
		const header = "| a | b |";
		const sep = "| --- | --- |";
		const body = rows.map(([first, second]) => `| ${first} | ${second} |`).join("\n");
		return [header, sep, body].join("\n");
	});

// "GFM-only" excludes mermaid: a `mermaid` fence whose body happens to start
// with a chart keyword (pie, xychart-beta, quadrantChart, sankey-beta) would
// otherwise produce a mermaid-chart diagnostic, breaking the invariance
// properties below by construction.
const fenceLangArb = fc
	.stringMatching(/^[A-Za-z0-9_-]*$/, { maxLength: 10 })
	.filter((lang) => lang !== "mermaid");
const fenceBodyArb = fc.string({ maxLength: 40 }).filter((body) => !body.includes("```"));
const fenceArb = fc
	.tuple(fenceLangArb, fenceBodyArb)
	.map(([lang, body]) => ["```" + lang, body, "```"].join("\n"));

const blockArb = fc.oneof(headingArb, paragraphArb, listArb, taskListArb, tableArb, fenceArb);

const docArb = fc
	.array(blockArb, { minLength: 0, maxLength: 6 })
	.map((blocks) => blocks.join("\n\n"));

// ---- Component-name generators -----------------------------------------

const identifierArb = fc
	.stringMatching(/^[A-Z][a-zA-Z0-9]{0,11}$/)
	.filter((name) => !fixtureComponentNames.includes(name));

describe("analyzeTree / validateSource — GFM invariance", () => {
	it("GFM-only docs produce no diagnostics from analyzeTree", () => {
		fc.assert(
			fc.property(docArb, (doc) => {
				const tree = parse(doc);
				expect(analyzeTree(tree)).toEqual([]);
			}),
		);
	});

	it("GFM-only docs validate ok via validateSource", async () => {
		await fc.assert(
			fc.asyncProperty(docArb, async (doc) => {
				const result = await validateSource({
					metadata: createMetadataPort(),
					source: doc,
					path: "x.mdx",
					registry: fixtureRegistry,
				});
				expect(result.ok).toBe(true);
				expect(result.diagnostics).toEqual([]);
			}),
			{ numRuns: 25 },
		);
	});
});

/** The diagnostics `remarkRestrict` reports for `tree` against the fixture registry. */
function restrictDiagnostics(tree: ReturnType<typeof parse>): RestrictDiagnostic[] {
	const diagnostics: RestrictDiagnostic[] = [];
	restrictTree(tree, {
		components: fixtureComponentNames,
		onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
	});
	return diagnostics;
}

describe("remarkRestrict — unknown components", () => {
	it("reports exactly one unknown-component diagnostic per injected name, at the right line", () => {
		fc.assert(
			fc.property(
				docArb,
				fc.uniqueArray(identifierArb, { minLength: 1, maxLength: 5 }),
				(doc, names) => {
					const parts = doc
						? [doc, ...names.map((name) => `<${name} />`)]
						: names.map((name) => `<${name} />`);
					const full = parts.join("\n\n");
					const lines = full.split("\n");

					const tree = parse(full);
					const diagnostics = restrictDiagnostics(tree);

					expect(diagnostics.length).toBe(names.length);
					const byComponent = new Map(
						diagnostics.map((diagnostic) => [diagnostic.component, diagnostic]),
					);
					for (const name of names) {
						const diag = byComponent.get(name);
						expect(diag).toBeDefined();
						expect(diag!.code).toBe("unknown-component");
						const expectedLine = lines.findIndex((line) => line === `<${name} />`) + 1;
						expect(diag!.line).toBe(expectedLine);
					}
					// The tags are gone, so analyzeTree has nothing left to report.
					expect(analyzeTree(tree)).toEqual([]);
				},
			),
		);
	});

	it("an import does not make a component known: each import and each tag is reported", () => {
		fc.assert(
			fc.property(
				docArb,
				fc.uniqueArray(fc.tuple(identifierArb, fc.boolean()), {
					minLength: 1,
					maxLength: 5,
					selector: (tuple) => tuple[0],
				}),
				(doc, namedFlags) => {
					const imported = namedFlags.filter(([, flag]) => flag).map(([name]) => name);
					const imports = imported.map((name) => `import ${name} from "./x";`).join("\n");
					const tags = namedFlags.map(([name]) => `<${name} />`).join("\n\n");
					const full = [imports, doc, tags].filter(Boolean).join("\n\n");

					const diagnostics = restrictDiagnostics(parse(full));
					const unknown = diagnostics.filter(
						(diagnostic) => diagnostic.code === "unknown-component",
					);
					const esm = diagnostics.filter((diagnostic) => diagnostic.code === "esm-not-supported");
					expect(new Set(unknown.map((diagnostic) => diagnostic.component))).toEqual(
						new Set(namedFlags.map(([name]) => name)),
					);
					expect(esm.length).toBe(imported.length);
				},
			),
		);
	});
});

describe("DocumentService.parse — unknown props", () => {
	const documents = new DocumentService(fixtureRegistry, (relative) => relative);

	const componentArb = fc.constantFrom(...fixtureRegistry.components);

	function propNamesOf(entry: (typeof fixtureRegistry.components)[number]): string[] {
		return Object.keys((entry.props?.properties as Record<string, unknown> | undefined) ?? {});
	}

	it("using only a subset of a component's own props yields no unknown-prop diagnostics", () => {
		fc.assert(
			fc.property(componentArb, fc.infiniteStream(fc.boolean()), (entry, coinFlips) => {
				const propNames = propNamesOf(entry);
				const stream = coinFlips;
				const chosen = propNames.filter(() => stream.next().value);
				const attrs = chosen.map((prop) => `${prop}="v"`).join(" ");
				const src = `<${entry.name}${attrs ? " " + attrs : ""} />`;
				const { diagnostics } = documents.parse(src, "x.mdx");
				expect(diagnostics.filter((diagnostic) => diagnostic.code === "unknown-prop")).toEqual([]);
			}),
		);
	});

	it("an attribute name outside the component's props (and not children/key) yields exactly one unknown-prop", () => {
		fc.assert(
			fc.property(componentArb, fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,9}$/), (entry, extra) => {
				const propNames = propNamesOf(entry);
				// `id` is the stateful builtins' own prop, checked by the id rules instead.
				fc.pre(
					!propNames.includes(extra) &&
						!["children", "key", "id", "class", "style"].includes(extra) &&
						// `on*` attributes are dropped earlier as unsupported-attribute.
						!/^on/i.test(extra),
				);
				const src = `<${entry.name} ${extra}="v" />`;
				const { diagnostics } = documents.parse(src, "x.mdx");
				const propDiags = diagnostics.filter((diagnostic) => diagnostic.code === "unknown-prop");
				expect(propDiags.length).toBe(1);
				expect(propDiags[0].prop).toBe(extra);
				expect(propDiags[0].component).toBe(entry.name);
				expect(propDiags[0].severity).toBe("warning");
			}),
		);
	});
});

describe("analyzeTree — lowercase tags", () => {
	it("never produces diagnostics for html-style lowercase tags", () => {
		fc.assert(
			fc.property(
				fc.constantFrom("<div>text</div>", '<span class="x">text</span>', "<br />", "<p>hi</p>"),
				(src) => {
					const tree = parse(src);
					expect(analyzeTree(tree)).toEqual([]);
				},
			),
		);
	});
});

describe("validateSource — examples", () => {
	it("an unclosed <Callout> is a single mdx-syntax error with a numeric line", async () => {
		const result = await validateSource({
			metadata: createMetadataPort(),
			source: "<Callout>\n\nhi",
			path: "x.mdx",
			registry: fixtureRegistry,
		});
		expect(result.ok).toBe(false);
		expect(result.diagnostics.length).toBe(1);
		expect(result.diagnostics[0].code).toBe("mdx-syntax");
		expect(typeof result.diagnostics[0].line).toBe("number");
	});

	it.each(["md", "mdx"])("a bare `<` before a digit is ok as .%s (escaped)", async (extension) => {
		// Mirrors the motivating example in src/document/lenient.ts: `<` immediately
		// followed by a digit is a hard JSX parse error, since MDX tries to read
		// it as a tag name. Both extensions get escapeBareLt run on them first.
		const result = await validateSource({
			metadata: createMetadataPort(),
			source: "(<800px)\n",
			path: `x.${extension}`,
			registry: fixtureRegistry,
		});
		expect(result.ok).toBe(true);
	});
});

describe("member tags on builtins", () => {
	it("reports <Builtin.Member> as unknown and does not check its props", () => {
		const tree = parse('<Callout.Foo tone="warn" bogus="x" />\n');
		const diagnostics = restrictDiagnostics(tree);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({ code: "unknown-component", component: "Callout.Foo" });
		expect(analyzeTree(tree)).toEqual([]);
	});
});

describe("esm-not-supported positions", () => {
	it("points at the import statement", async () => {
		const result = await validateSource({
			metadata: createMetadataPort(),
			source: '# T\n\nimport Missing from "./missing"\n\n<Missing />\n',
			path: "/x/doc.mdx",
			registry: fixtureRegistry,
		});
		const error = result.diagnostics.find((diagnostic) => diagnostic.code === "esm-not-supported");
		expect(error).toMatchObject({ severity: "error", line: 3, column: 1 });
	});
});

// ---- mermaid-chart -------------------------------------------------------

const chartFenceArb = fc
	.constantFrom<ChartDiagramKeyword>(...CHART_DIAGRAM_KEYWORDS)
	.map((keyword) => ({
		keyword,
		text: ["```mermaid", keyword, "```"].join("\n"),
	}));

const nonChartMermaidFenceArb = fc
	.constantFrom(
		"flowchart TD\n  A --> B",
		"sequenceDiagram\n  A->>B: hi",
		"classDiagram\n  class A",
	)
	.map((body) => ["```mermaid", body, "```"].join("\n"));

describe("analyzeTree — mermaid-chart", () => {
	it("injecting k chart fences yields exactly k mermaid-chart diagnostics at the right lines", () => {
		fc.assert(
			fc.property(
				docArb,
				fc.array(chartFenceArb, { minLength: 1, maxLength: 4 }),
				(doc, fences) => {
					const parts = doc
						? [doc, ...fences.map((fence) => fence.text)]
						: fences.map((fence) => fence.text);
					const full = parts.join("\n\n");
					const lines = full.split("\n");

					const tree = parse(full);
					const diagnostics = analyzeTree(tree);
					const chartDiagnostics = diagnostics.filter(
						(diagnostic) => diagnostic.code === "mermaid-chart",
					);

					expect(chartDiagnostics.length).toBe(fences.length);
					const openingLines = lines
						.map((line, index) => (line === "```mermaid" ? index + 1 : -1))
						.filter((lineNumber) => lineNumber !== -1)
						.sort((first, second) => first - second);
					const reportedLines = chartDiagnostics
						.map((diagnostic) => diagnostic.line)
						.sort((first, second) => (first ?? 0) - (second ?? 0));
					expect(reportedLines).toEqual(openingLines);
				},
			),
		);
	});

	it("injecting non-chart mermaid fences adds no mermaid-chart diagnostics", () => {
		fc.assert(
			fc.property(
				docArb,
				fc.array(nonChartMermaidFenceArb, { minLength: 1, maxLength: 4 }),
				(doc, fences) => {
					const parts = doc ? [doc, ...fences] : fences;
					const full = parts.join("\n\n");
					const tree = parse(full);
					const diagnostics = analyzeTree(tree);
					expect(diagnostics.filter((diagnostic) => diagnostic.code === "mermaid-chart")).toEqual(
						[],
					);
				},
			),
		);
	});
});

// ---- hints ----------------------------------------------------------------
// A Markdown image is a screenshot candidate when its alt text or its path
// mentions "screen"; every other image is left alone.

const plainWordArb = fc.stringMatching(/^[a-z]{1,8}$/).filter((word) => !word.includes("screen"));

const screenshotImageArb = fc.oneof(
	fc
		.tuple(plainWordArb, fc.nat({ max: 99 }))
		.map(([word, num]) => `![${word} screen](./${word}-${num}.png)`),
	fc
		.tuple(plainWordArb, fc.nat({ max: 99 }))
		.map(([word, num]) => `![${word}](./Screenshot-${num}.png)`),
	fc
		.tuple(plainWordArb, fc.nat({ max: 99 }))
		.map(([word, num]) => `![${word}](../SCREENS/${word}-${num}.jpg)`),
);

const plainImageArb = fc
	.tuple(plainWordArb, fc.nat({ max: 99 }))
	.map(([word, num]) => `![${word}](./${word}-${num}.png)`);

function imageLines(full: string): number[] {
	return full
		.split("\n")
		.map((line, index) => (line.startsWith("![") ? index + 1 : -1))
		.filter((lineNumber) => lineNumber !== -1);
}

describe("collectHints — screenshot images", () => {
	it("GFM-only docs (no images) produce no hints", () => {
		fc.assert(
			fc.property(docArb, (doc) => {
				expect(collectHints(parse(doc))).toEqual([]);
			}),
		);
	});

	it("images whose alt and path avoid 'screen' produce no hints", () => {
		fc.assert(
			fc.property(
				docArb,
				fc.array(plainImageArb, { minLength: 1, maxLength: 4 }),
				(doc, images) => {
					const full = (doc ? [doc, ...images] : images).join("\n\n");
					expect(collectHints(parse(full))).toEqual([]);
				},
			),
		);
	});

	it("injecting k screenshot-looking images yields exactly one hint that names every line and <Screenshot>", () => {
		fc.assert(
			fc.property(
				docArb,
				fc.array(screenshotImageArb, { minLength: 1, maxLength: 4 }),
				fc.array(plainImageArb, { maxLength: 2 }),
				(doc, screenshots, plain) => {
					const parts = [...(doc ? [doc] : []), ...screenshots, ...plain];
					const full = parts.join("\n\n");
					const hints = collectHints(parse(full));
					expect(hints).toHaveLength(1);
					expect(hints[0]).toContain("<Screenshot");
					// The image lines of the screenshot ones only: the plain ones
					// follow them in the doc, and must not be listed.
					const expectedLines = imageLines(full).slice(0, screenshots.length);
					const listed = (hints[0].match(/\d+/g) ?? []).map(Number);
					expect(listed.slice(0, expectedLines.length)).toEqual(expectedLines);
				},
			),
		);
	});

	it("validateSource carries the same hints, and they never affect ok", async () => {
		await fc.assert(
			fc.asyncProperty(
				docArb,
				fc.array(screenshotImageArb, { minLength: 1, maxLength: 3 }),
				async (doc, screenshots) => {
					const full = (doc ? [doc, ...screenshots] : screenshots).join("\n\n");
					const result = await validateSource({
						metadata: createMetadataPort(),
						source: full,
						path: "/tmp/hints.mdx",
						registry: fixtureRegistry,
					});
					expect(result.ok).toBe(true);
					expect(result.diagnostics).toEqual([]);
					expect(result.hints).toEqual(collectHints(parse(full)));
				},
			),
		);
	});
});
