import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
	CHART_DIAGRAM_KEYWORDS,
	chartDiagramKeyword,
	chartDiagramMessage,
	type ChartDiagramKeyword,
} from "../../client/mermaid-chart.js";
import { readFlowchartDirection } from "../../client/mermaid-direction.js";

const chartKeywordArb = fc.constantFrom<ChartDiagramKeyword>(...CHART_DIAGRAM_KEYWORDS);
const indentArb = fc.constantFrom("", "  ", "\t");
const argSuffixArb = fc.constantFrom("", " title Pets", " beta", " ;", "  %% trailing");

/** A line that never reads as a chart header, a flowchart header, a front-matter
 * fence, or a comment, so it can only be body noise. */
const bodyLineArb = fc
	.stringMatching(/^[A-Za-z0-9 _>|[\]()":.,-]*$/)
	.filter(
		(line) =>
			!/^\s*(flowchart|graph)\b/.test(line) &&
			!line.trimStart().startsWith("%%") &&
			line.trim() !== "---" &&
			!CHART_DIAGRAM_KEYWORDS.some((keyword) => new RegExp(`^\\s*${keyword}(?:\\s|$)`).test(line)),
	);

const bodyArb = fc.array(bodyLineArb, { maxLength: 6 }).map((lines) => lines.join("\n"));

const frontMatterArb = fc.option(
	fc
		.array(fc.stringMatching(/^[a-z]+: [A-Za-z ]+$/), { maxLength: 3 })
		.map((fields) => ["---", ...fields, "---"].join("\n")),
	{ nil: null },
);

const preambleArb = fc.array(
	fc.oneof(
		fc.constant(""),
		fc.stringMatching(/^%% [A-Za-z ]*$/),
		fc.constant('%%{init: {"theme": "base"}}%%'),
		fc.constant('%%{init: {\n  "theme": "base"\n}}%%'),
	),
	{ maxLength: 3 },
);

/** A chart diagram the way an author might write one, plus the keyword it opens with. */
const chartDocArb = fc
	.tuple(frontMatterArb, preambleArb, chartKeywordArb, indentArb, argSuffixArb, bodyArb)
	.map(([matter, preamble, keyword, indent, suffix, rest]) => {
		const header = `${indent}${keyword}${suffix}`;
		const source = [...(matter === null ? [] : [matter]), ...preamble, header, rest].join("\n");
		return { source, keyword };
	});

const otherDiagramHeaderArb = fc.constantFrom(
	"flowchart TD",
	"graph LR",
	"sequenceDiagram",
	"classDiagram",
	"stateDiagram-v2",
	"erDiagram",
	"gantt",
	"timeline",
	"gitGraph",
	"mindmap",
	"journey",
	"C4Context",
);

describe("chartDiagramKeyword — recognition", () => {
	it("recognizes every chart keyword through indent, args, preamble, and body noise", () => {
		fc.assert(
			fc.property(chartDocArb, ({ source, keyword }) => {
				expect(chartDiagramKeyword(source)).toBe(keyword);
			}),
		);
	});
});

describe("chartDiagramKeyword — specificity", () => {
	it("never matches a generated flowchart/other-diagram header", () => {
		fc.assert(
			fc.property(otherDiagramHeaderArb, bodyArb, (head, rest) => {
				const source = [head, rest].join("\n");
				expect(chartDiagramKeyword(source)).toBeNull();
			}),
		);
	});

	it("a chart keyword appearing only in the body (never the header) stays null", () => {
		fc.assert(
			fc.property(otherDiagramHeaderArb, chartKeywordArb, (head, keyword) => {
				const source = `${head}\n${keyword}\nmore text`;
				expect(chartDiagramKeyword(source)).toBeNull();
			}),
		);
	});
});

describe("chartDiagramKeyword — prefix strictness", () => {
	it("a keyword directly followed by more identifier characters is not recognised", () => {
		fc.assert(
			fc.property(chartKeywordArb, fc.stringMatching(/^[A-Za-z0-9_-]+$/), (keyword, extra) => {
				expect(chartDiagramKeyword(`${keyword}${extra}`)).toBeNull();
			}),
		);
	});

	it("a keyword followed by whitespace is recognised regardless of what follows", () => {
		fc.assert(
			fc.property(
				chartKeywordArb,
				fc.string({ maxLength: 20 }).filter((text) => !text.includes("\n")),
				(keyword, rest) => {
					expect(chartDiagramKeyword(`${keyword} ${rest}`)).toBe(keyword);
				},
			),
		);
	});
});

describe("chartDiagramKeyword — disjoint from flowchart direction", () => {
	it("a recognised chart source never reads as a flowchart direction", () => {
		fc.assert(
			fc.property(chartDocArb, ({ source }) => {
				expect(readFlowchartDirection(source)).toBeNull();
			}),
		);
	});
});

describe("chartDiagramMessage", () => {
	it("always names the keyword and <Chart>", () => {
		fc.assert(
			fc.property(chartKeywordArb, (keyword) => {
				const message = chartDiagramMessage(keyword);
				expect(message).toContain(keyword);
				expect(message).toContain("<Chart>");
			}),
		);
	});
});
