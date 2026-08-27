import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { mdxjs } from "micromark-extension-mdxjs";
import {
	analyzeTree,
	collectLocalNames,
	fromCompileError,
	validateSource,
	type Diagnostic,
} from "../../src/validation/validate.js";
import { fixtureComponentNames, fixtureRegistry } from "../fixtures/registry.js";
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
				expect(analyzeTree(tree, fixtureRegistry)).toEqual([]);
			}),
		);
	});

	it("GFM-only docs validate ok via validateSource", async () => {
		await fc.assert(
			fc.asyncProperty(docArb, async (doc) => {
				const result = await validateSource({
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

describe("analyzeTree — unknown components", () => {
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
					const diagnostics = analyzeTree(tree, fixtureRegistry);

					expect(diagnostics.length).toBe(names.length);
					const byComponent = new Map(
						diagnostics.map((diagnostic) => [diagnostic.component, diagnostic]),
					);
					for (const name of names) {
						const diag = byComponent.get(name);
						expect(diag).toBeDefined();
						expect(diag!.code).toBe("unknown-component");
						expect(diag!.severity).toBe("error");
						const expectedLine = lines.findIndex((line) => line === `<${name} />`) + 1;
						expect(diag!.line).toBe(expectedLine);
					}
				},
			),
		);
	});

	it("imported names are excluded; the rest still get exactly one diagnostic", () => {
		fc.assert(
			fc.property(
				docArb,
				fc.uniqueArray(fc.tuple(identifierArb, fc.boolean()), {
					minLength: 1,
					maxLength: 5,
					selector: (tuple) => tuple[0],
				}),
				(doc, namedFlags) => {
					const imports = namedFlags
						.filter(([, imported]) => imported)
						.map(([name]) => `import ${name} from "./x";`)
						.join("\n");
					const tags = namedFlags.map(([name]) => `<${name} />`).join("\n\n");
					const full = [imports, doc, tags].filter(Boolean).join("\n\n");

					const tree = parse(full);
					const diagnostics = analyzeTree(tree, fixtureRegistry);
					const reported = new Set(diagnostics.map((diagnostic) => diagnostic.component));

					for (const [name, imported] of namedFlags) {
						expect(reported.has(name)).toBe(!imported);
					}
					expect(diagnostics.length).toBe(namedFlags.filter(([, imported]) => !imported).length);
				},
			),
		);
	});
});

describe("analyzeTree — props", () => {
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
				const tree = parse(src);
				const diagnostics = analyzeTree(tree, fixtureRegistry);
				expect(
					diagnostics.filter((diagnostic: Diagnostic) => diagnostic.code === "unknown-prop"),
				).toEqual([]);
			}),
		);
	});

	it("an attribute name outside the component's props (and not children/key) yields exactly one unknown-prop", () => {
		fc.assert(
			fc.property(componentArb, fc.stringMatching(/^[a-z][a-zA-Z0-9]{0,9}$/), (entry, extra) => {
				const propNames = propNamesOf(entry);
				fc.pre(!propNames.includes(extra) && extra !== "children" && extra !== "key");
				const src = `<${entry.name} ${extra}="v" />`;
				const tree = parse(src);
				const diagnostics = analyzeTree(tree, fixtureRegistry);
				const propDiags = diagnostics.filter(
					(diagnostic: Diagnostic) => diagnostic.code === "unknown-prop",
				);
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
					expect(analyzeTree(tree, fixtureRegistry)).toEqual([]);
				},
			),
		);
	});
});

describe("validateSource — examples", () => {
	it("an unclosed <Callout> is a single mdx-compile error with a numeric line", async () => {
		const result = await validateSource({
			source: "<Callout>\n\nhi",
			path: "x.mdx",
			registry: fixtureRegistry,
		});
		expect(result.ok).toBe(false);
		expect(result.diagnostics.length).toBe(1);
		expect(result.diagnostics[0].code).toBe("mdx-compile");
		expect(typeof result.diagnostics[0].line).toBe("number");
	});

	it("a bare `<` before a digit is ok as .md (escaped) but not as .mdx", async () => {
		// Mirrors the motivating example in src/rendering/mdx/lenient-md.ts: `<` immediately
		// followed by a digit is a hard JSX parse error, since MDX tries to read
		// it as a tag name. `.md` gets escapeBareLt run on it first; `.mdx` does
		// not.
		const md = await validateSource({
			source: "(<800px)\n",
			path: "x.md",
			registry: fixtureRegistry,
		});
		expect(md.ok).toBe(true);

		const mdx = await validateSource({
			source: "(<800px)\n",
			path: "x.mdx",
			registry: fixtureRegistry,
		});
		expect(mdx.ok).toBe(false);
	});
});

describe("fromCompileError", () => {
	it("a plain Error has no line", () => {
		const diag = fromCompileError(new Error("boom"));
		expect(diag.code).toBe("mdx-compile");
		expect(diag.message).toBe("boom");
		expect(diag.line).toBeUndefined();
	});
});

describe("collectLocalNames declarations", () => {
	const cases: Array<[string, string]> = [
		["export default function Layout() { return null }", "Layout"],
		["export default class Frame {}", "Frame"],
		["export class Panel {}", "Panel"],
		["export function Row() { return null }", "Row"],
		["export const Cell = () => null", "Cell"],
	];

	for (const [esm, name] of cases) {
		it(`binds ${name} from \`${esm}\``, () => {
			const tree = parse(`${esm}\n\n<${name} />\n`);
			expect(collectLocalNames(tree).has(name)).toBe(true);
			expect(analyzeTree(tree, fixtureRegistry)).toEqual([]);
		});
	}
});

describe("member tags on builtins", () => {
	it("reports <Builtin.Member> as unknown and does not check its props", () => {
		const tree = parse('<Callout.Foo tone="warn" bogus="x" />\n');
		const diagnostics = analyzeTree(tree, fixtureRegistry);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({ code: "unknown-component", component: "Callout.Foo" });
	});

	it("leaves <Local.Member> alone when Local is imported", () => {
		const tree = parse('import Local from "./x"\n\n<Local.Member />\n');
		expect(analyzeTree(tree, fixtureRegistry)).toEqual([]);
	});
});

// ---- render step -------------------------------------------------------
// The real render step is `RenderService#render` in src/rendering/render.ts
// (owned by a concurrent change); here we inject a fake `render` matching its
// shape so the wiring in validateSource can be tested in isolation.

type FakeRenderOutcome =
	{ ok: true } | { ok: false; message: string; line?: number; column?: number };

function fakeRender(outcome: FakeRenderOutcome): (absPath: string) => Promise<FakeRenderOutcome> {
	return async () => outcome;
}

// A doc generator that never contains `{` or `<` anywhere, including inside
// fenced code blocks (unlike the top-level `docArb`, whose fence bodies draw
// from the full string alphabet) — used by the render-step invariance test
// below, which needs that guarantee to hold for the whole generated string.
const plainFenceBodyArb = fc
	.string({ maxLength: 40 })
	.filter((text) => !text.includes("```") && !text.includes("{") && !text.includes("<"));
const plainFenceArb = fc
	.tuple(fenceLangArb, plainFenceBodyArb)
	.map(([lang, body]) => ["```" + lang, body, "```"].join("\n"));
const plainBlockArb = fc.oneof(
	headingArb,
	paragraphArb,
	listArb,
	taskListArb,
	tableArb,
	plainFenceArb,
);
const plainDocArb = fc
	.array(plainBlockArb, { minLength: 0, maxLength: 6 })
	.map((blocks) => blocks.join("\n\n"));

describe("validateSource — render step", () => {
	it("a render failure yields exactly one render-error diagnostic, ok:false, rendered:true", async () => {
		const result = await validateSource({
			source: "# Fine\n\nSome plain content.\n",
			path: "x.mdx",
			registry: fixtureRegistry,
			render: fakeRender({ ok: false, message: "boom is not defined", line: 3, column: 1 }),
		});
		expect(result.rendered).toBe(true);
		expect(result.ok).toBe(false);
		const renderErrors = result.diagnostics.filter(
			(diagnostic) => diagnostic.code === "render-error",
		);
		expect(renderErrors).toHaveLength(1);
		expect(renderErrors[0]).toMatchObject({
			severity: "error",
			code: "render-error",
			message: "boom is not defined",
			line: 3,
			column: 1,
		});
	});

	it("render is not called when a static error already exists", async () => {
		let called = false;
		const result = await validateSource({
			source: "<Calout />\n",
			path: "x.mdx",
			registry: fixtureRegistry,
			render: async () => {
				called = true;
				return { ok: true };
			},
		});
		expect(result.ok).toBe(false);
		expect(result.rendered).toBe(false);
		expect(called).toBe(false);
	});

	it("property: for docs with no `{`/`<` at all that validate ok statically, a passing render never flips ok, and render-error only appears when rendered:true", async () => {
		await fc.assert(
			fc.asyncProperty(plainDocArb, fc.boolean(), async (doc, renderOk) => {
				const outcome: FakeRenderOutcome = renderOk
					? { ok: true }
					: { ok: false, message: "render failed" };
				const result = await validateSource({
					source: doc,
					path: "x.mdx",
					registry: fixtureRegistry,
					render: fakeRender(outcome),
				});

				expect(result.rendered).toBe(true);
				const hasRenderError = result.diagnostics.some(
					(diagnostic) => diagnostic.code === "render-error",
				);
				expect(hasRenderError).toBe(!renderOk);
				expect(hasRenderError ? true : result.rendered).toBe(true);
				if (renderOk) expect(result.ok).toBe(true);
				else expect(result.ok).toBe(false);
			}),
			{ numRuns: 25 },
		);
	});

	it("no render-error diagnostic is ever present when rendered is false", async () => {
		const result = await validateSource({
			source: "# No render configured\n",
			path: "x.mdx",
			registry: fixtureRegistry,
		});
		expect(result.rendered).toBe(false);
		expect(result.diagnostics.some((diagnostic) => diagnostic.code === "render-error")).toBe(false);
	});
});

describe("unresolved-import positions", () => {
	it("points at the import statement", async () => {
		const result = await validateSource({
			source: '# T\n\nimport Missing from "./missing"\n\n<Missing />\n',
			path: "/x/doc.mdx",
			registry: fixtureRegistry,
			resolveImport: () => false,
		});
		const warning = result.diagnostics.find(
			(diagnostic) => diagnostic.code === "unresolved-import",
		);
		expect(warning).toMatchObject({ line: 3, column: 1 });
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
					const diagnostics = analyzeTree(tree, fixtureRegistry);
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
					const diagnostics = analyzeTree(tree, fixtureRegistry);
					expect(diagnostics.filter((diagnostic) => diagnostic.code === "mermaid-chart")).toEqual(
						[],
					);
				},
			),
		);
	});
});
