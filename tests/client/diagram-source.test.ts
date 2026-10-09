import { expect, it } from "vitest";
import { locateDiagram } from "../../client/diagrams/source";

it("replaces only the selected diagram and preserves surrounding Markdown exactly", () => {
	const source = "flowchart LR\n A --> B";
	const fence = `~~~mermaid\n${source}\n~~~`;
	const markdown = `# Title\n\n${fence}\n\nUnusual   spacing\n\n${fence}\n\nEnd`;
	const diagram = locateDiagram(markdown, { index: 1, source })!;
	expect(diagram.replace("flowchart LR\n A --> C")).toBe(
		`# Title\n\n${fence}\n\nUnusual   spacing\n\n~~~mermaid\nflowchart LR\n A --> C\n~~~\n\nEnd`,
	);
	expect(locateDiagram(markdown, { index: 1, source: "flowchart LR\n A --> Z" })).toBeNull();
});
it("preserves the nesting prefix of a blockquoted diagram", () => {
	const markdown = "> ```mermaid\n> flowchart LR\n>  A --> B\n> ```\n\nAfter";
	const diagram = locateDiagram(markdown, { index: 0, source: "flowchart LR\n A --> B" })!;
	expect(diagram.replace("flowchart LR\n A --> C")).toBe(
		"> ```mermaid\n> flowchart LR\n>  A --> C\n> ```\n\nAfter",
	);
});
it("ignores highlighted blank-line padding without changing the input source", () => {
	const diagram = locateDiagram("```mermaid\nflowchart LR\n\n A --> B\n```", {
		index: 0,
		source: "flowchart LR\n \n A --> B",
	});
	expect(diagram?.source).toBe("flowchart LR\n\n A --> B");
});

it.each(["```", "~~~~"])("edits a %s fence terminated by EOF", (fence) => {
	const markdown = `# Before\n\n${fence}mermaid\nflowchart LR\n A --> B`;
	const diagram = locateDiagram(markdown, { index: 0, source: "flowchart LR\n A --> B" })!;
	expect(diagram.replace("flowchart LR\n A --> C")).toBe(
		`# Before\n\n${fence}mermaid\nflowchart LR\n A --> C\n${fence}`,
	);
});
it("closes an EOF fence while preserving nested indentation and trailing newline", () => {
	const diagram = locateDiagram("> ```mermaid\n> flowchart LR\n>  A --> B\n", {
		index: 0,
		source: "flowchart LR\n A --> B",
	})!;
	expect(diagram.replace("flowchart LR\n A --> C")).toBe(
		"> ```mermaid\n> flowchart LR\n>  A --> C\n> ```\n",
	);
});
it("can populate an empty EOF fence", () => {
	const diagram = locateDiagram("```mermaid", { index: 0, source: "" })!;
	expect(diagram.replace("flowchart LR\n A --> B")).toBe("```mermaid\nflowchart LR\n A --> B\n```");
});
