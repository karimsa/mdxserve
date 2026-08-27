/**
 * Shared, framework-free mermaid header detection: locating the line that
 * names a mermaid diagram's type (skipping blank lines, a leading `---`
 * front-matter block, `%%` comments, and multi-line `%%{init: …}%%`
 * directives), and recognising the handful of diagram types that draw
 * charts of data — the kind mdxserve's builtin `<Chart>` component already
 * covers, and renders far better (design tokens, hover, expand).
 *
 * Pure and import-free like `client/mermaid-direction.ts`, so it is safe to
 * ship in the browser bundle. `src/` importing a pure module from `client/`
 * is fine — the AGENTS.md rule against crossing the boundary is
 * one-directional, and `scripts/build-registry.ts` already imports
 * `client/builtins/index.ts` the same way — but this file itself must stay
 * import-free and browser-safe: no `src/`, no Node builtins, no React.
 */

export const CHART_DIAGRAM_KEYWORDS = [
	"pie",
	"xychart-beta",
	"quadrantChart",
	"sankey-beta",
] as const;

export type ChartDiagramKeyword = (typeof CHART_DIAGRAM_KEYWORDS)[number];

const CHART_HEADER_PATTERNS: Record<ChartDiagramKeyword, RegExp> = {
	pie: /^pie(?:\s|$)/,
	"xychart-beta": /^xychart-beta(?:\s|$)/,
	quadrantChart: /^quadrantChart(?:\s|$)/,
	"sankey-beta": /^sankey-beta(?:\s|$)/,
};

const CHART_DIAGRAM_ALTERNATIVES: Record<ChartDiagramKeyword, string> = {
	pie: "use a bar chart or a table for part-to-whole",
	"xychart-beta": 'use type="bar" or type="line"',
	quadrantChart: "use a table (one row per item, a column per axis)",
	"sankey-beta": "use a table, or totals as bars",
};

/**
 * Index of the line in `lines` that starts the diagram's content: blanks, a
 * leading `---` front-matter block, `%%` comment lines, and a directive that
 * spans several lines (`%%{init: {\n …\n }}%%`) are all skipped. -1 when the
 * source has no such line (empty, or an unclosed front-matter block).
 */
export function mermaidHeaderLineIndex(lines: string[]): number {
	let index = 0;
	while (index < lines.length && lines[index]!.trim() === "") index++;
	if (lines[index]?.trim() === "---") {
		const close = lines.findIndex((line, at) => at > index && line.trim() === "---");
		if (close === -1) return -1;
		index = close + 1;
	}
	let inDirective = false;
	for (; index < lines.length; index++) {
		const line = lines[index]!;
		if (inDirective) {
			if (line.includes("}%%")) inDirective = false;
			continue;
		}
		const trimmed = line.trim();
		if (trimmed === "") continue;
		if (trimmed.startsWith("%%")) {
			if (trimmed.startsWith("%%{") && !trimmed.includes("}%%")) inDirective = true;
			continue;
		}
		return index;
	}
	return -1;
}

/**
 * The trimmed header line of a mermaid fence's `source`, or `undefined` when
 * there isn't one (an empty fence, or an unclosed front-matter block).
 */
export function mermaidHeaderLine(source: string): string | undefined {
	const lines = source.split(/\r?\n/);
	const index = mermaidHeaderLineIndex(lines);
	return index === -1 ? undefined : lines[index]!.trim();
}

/**
 * The chart-diagram keyword a mermaid `source` opens with, or `null` for
 * every other diagram type (flow, sequence, class, state, ER, gantt,
 * timeline, gitGraph, mindmap, journey, C4, …). Matches on a word boundary,
 * so `pieChart`, `xychart`, and `sankey` (near-misses, not the real
 * keywords) never match, and the keyword must be the header line itself —
 * one appearing later in the body does not count.
 */
export function chartDiagramKeyword(source: string): ChartDiagramKeyword | null {
	const header = mermaidHeaderLine(source);
	if (header === undefined) return null;
	for (const keyword of CHART_DIAGRAM_KEYWORDS) {
		if (CHART_HEADER_PATTERNS[keyword].test(header)) return keyword;
	}
	return null;
}

/**
 * The one steer shown to a reader (in the "don't render here" card) and an
 * agent (in a `validate_doc` diagnostic) for a rejected chart diagram.
 */
export function chartDiagramMessage(keyword: ChartDiagramKeyword): string {
	return (
		`Mermaid \`${keyword}\` charts do not render in mdxserve. Use the builtin <Chart> ` +
		`component instead (type="bar" | "line" | "area" | "histogram", orientation="horizontal" ` +
		`for horizontal bars) — ${CHART_DIAGRAM_ALTERNATIVES[keyword]}.`
	);
}
