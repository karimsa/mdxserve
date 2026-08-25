import { describe, expect, it } from "vitest";
import { readFlowchartDirection, setFlowchartDirection } from "../../client/mermaid-direction.js";

describe("readFlowchartDirection", () => {
	it("reads the direction off flowchart and graph headers", () => {
		expect(readFlowchartDirection("flowchart LR\n  A --> B")).toBe("LR");
		expect(readFlowchartDirection("graph RL\n  A --> B")).toBe("RL");
		expect(readFlowchartDirection("flowchart-elk BT\n  A --> B")).toBe("BT");
		expect(readFlowchartDirection("  graph TB;\n  A --> B")).toBe("TB");
	});

	it("treats TD as TB and a missing direction as TB", () => {
		expect(readFlowchartDirection("graph TD\n  A --> B")).toBe("TB");
		expect(readFlowchartDirection("flowchart\n  A --> B")).toBe("TB");
	});

	it("looks past front matter, comments and directives", () => {
		const source = [
			"---",
			"title: Pipeline",
			"---",
			"%% a comment",
			"%%{init: {",
			'  "theme": "base"',
			"}}%%",
			"flowchart LR",
			"  A --> B",
		].join("\n");
		expect(readFlowchartDirection(source)).toBe("LR");
	});

	it("returns null for other diagram types and near-misses", () => {
		expect(readFlowchartDirection("sequenceDiagram\n  A->>B: hi")).toBeNull();
		expect(readFlowchartDirection("graphs LR")).toBeNull();
		expect(readFlowchartDirection("flowchartLR")).toBeNull();
		expect(readFlowchartDirection("A --> B\nflowchart LR")).toBeNull();
		expect(readFlowchartDirection("---\ntitle: x\nflowchart LR")).toBeNull();
		expect(readFlowchartDirection("")).toBeNull();
	});
});

describe("setFlowchartDirection", () => {
	it("rewrites only the direction token", () => {
		expect(setFlowchartDirection("flowchart LR\n  A --> B", "TB")).toBe("flowchart TB\n  A --> B");
		expect(setFlowchartDirection("  graph TD;  %% hi\n  A --> B", "LR")).toBe(
			"  graph LR;  %% hi\n  A --> B",
		);
		expect(setFlowchartDirection("flowchart-elk\tRL\r\n  A --> B", "BT")).toBe(
			"flowchart-elk\tBT\r\n  A --> B",
		);
	});

	it("adds a direction to a bare header", () => {
		expect(setFlowchartDirection("flowchart\n  A --> B", "LR")).toBe("flowchart LR\n  A --> B");
		expect(setFlowchartDirection("graph;\n  A --> B", "RL")).toBe("graph RL;\n  A --> B");
	});

	it("leaves the source alone when nothing would change", () => {
		const alreadyThere = "graph TD\n  A --> B";
		expect(setFlowchartDirection(alreadyThere, "TB")).toBe(alreadyThere);
		const bare = "flowchart\n  A --> B";
		expect(setFlowchartDirection(bare, "TB")).toBe(bare);
		const sequence = "sequenceDiagram\n  A->>B: hi";
		expect(setFlowchartDirection(sequence, "LR")).toBe(sequence);
	});

	it("keeps front matter and directives byte-for-byte", () => {
		const prefix = '---\ntitle: Pipeline\n---\n%%{init: {"theme": "base"}}%%\n';
		expect(setFlowchartDirection(`${prefix}graph LR\n  A --> B`, "BT")).toBe(
			`${prefix}graph BT\n  A --> B`,
		);
	});
});
