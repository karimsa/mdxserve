import { describe, expect, it } from "vitest";
import {
	CHART_DIAGRAM_KEYWORDS,
	chartDiagramKeyword,
	chartDiagramMessage,
	type ChartDiagramKeyword,
} from "../../client/mermaid-chart.js";

const REALISTIC: Record<ChartDiagramKeyword, string> = {
	pie: 'pie title Pets\n  "Dogs" : 40\n  "Cats" : 60',
	"xychart-beta": 'xychart-beta\n  title "Sales"\n  x-axis [jan, feb]\n  bar [10, 20]',
	quadrantChart: "quadrantChart\n  title Reach vs Engagement\n  x-axis Low --> High",
	"sankey-beta": "sankey-beta\n\nA,B,10",
};

describe("chartDiagramKeyword — recognizes every chart keyword", () => {
	for (const keyword of CHART_DIAGRAM_KEYWORDS) {
		it(`recognizes ${keyword} in a realistic diagram`, () => {
			expect(chartDiagramKeyword(REALISTIC[keyword])).toBe(keyword);
		});

		it(`recognizes ${keyword} indented`, () => {
			expect(chartDiagramKeyword(`  ${REALISTIC[keyword]}`)).toBe(keyword);
		});

		it(`recognizes ${keyword} with a trailing comment on the header line`, () => {
			expect(chartDiagramKeyword(`${keyword} %% trailing\nmore`)).toBe(keyword);
		});
	}
});

describe("chartDiagramKeyword — null for every non-chart diagram", () => {
	const notCharts = [
		"flowchart TD\n  A --> B",
		"graph LR\n  A --> B",
		"sequenceDiagram\n  A->>B: hi",
		"classDiagram\n  class A",
		"stateDiagram-v2\n  [*] --> A",
		"erDiagram\n  A ||--o{ B : has",
		"gantt\n  title A schedule",
		"timeline\n  title History",
		"gitGraph\n  commit",
		"mindmap\n  root((A))",
		"journey\n  title A journey",
		"C4Context\n  title A system",
		"",
	];

	for (const source of notCharts) {
		it(`returns null for ${JSON.stringify(source.slice(0, 20))}`, () => {
			expect(chartDiagramKeyword(source)).toBeNull();
		});
	}
});

describe("chartDiagramKeyword — near-misses stay null", () => {
	const nearMisses = ["pieChart", "xychart", "sankey", "quadrant"];

	for (const nearMiss of nearMisses) {
		it(`returns null for ${nearMiss}`, () => {
			expect(chartDiagramKeyword(`${nearMiss}\nmore`)).toBeNull();
		});
	}
});

describe("chartDiagramKeyword — keyword must be the header, not the body", () => {
	it("returns null when a chart keyword appears only in the body", () => {
		expect(chartDiagramKeyword("flowchart TD\n  pie\n  A --> B")).toBeNull();
	});
});

describe("chartDiagramKeyword — front matter and directives", () => {
	it("skips a closed front-matter block", () => {
		const source = ["---", "title: Pets", "---", "pie", '  "Dogs" : 1'].join("\n");
		expect(chartDiagramKeyword(source)).toBe("pie");
	});

	it("skips a multi-line %%{init}%% directive", () => {
		const source = ["%%{init: {", '  "theme": "base"', "}}%%", "xychart-beta", "  title X"].join(
			"\n",
		);
		expect(chartDiagramKeyword(source)).toBe("xychart-beta");
	});

	it("returns null for an unclosed front-matter block", () => {
		const source = ["---", "title: Pets", "pie", '  "Dogs" : 1'].join("\n");
		expect(chartDiagramKeyword(source)).toBeNull();
	});
});

describe("chartDiagramMessage", () => {
	for (const keyword of CHART_DIAGRAM_KEYWORDS) {
		it(`names ${keyword} and <Chart>`, () => {
			const message = chartDiagramMessage(keyword);
			expect(message).toContain(keyword);
			expect(message).toContain("<Chart>");
		});
	}
});
