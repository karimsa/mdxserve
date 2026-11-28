import { describe, expect, it } from "vitest";
import { collectTreeBlocks } from "../comments/tree-blocks";
import type { BlockNode, DocumentTree, InlineNode } from "../document/tree-types";

function text(value: string): InlineNode {
	return { type: "text", value };
}

function paragraph(
	...children: (InlineNode | string)[]
): Extract<BlockNode, { type: "paragraph" }> {
	return {
		type: "paragraph",
		children: children.map((child) => (typeof child === "string" ? text(child) : child)),
	};
}

function section(
	heading: string,
	...children: BlockNode[]
): Extract<BlockNode, { type: "section" }> {
	return { type: "section", id: heading, level: 2, heading: [text(heading)], children };
}

function list(...items: BlockNode[][]): BlockNode {
	return {
		type: "list",
		ordered: false,
		start: null,
		items: items.map((children) => ({ checked: null, children })),
	};
}

function code(value: string, lang: string | null): Extract<BlockNode, { type: "code" }> {
	return {
		type: "code",
		id: null,
		lang,
		title: null,
		showLineNumbers: false,
		highlightLines: [],
		value,
	};
}

function tabs(...contents: [string, BlockNode[]][]): Extract<BlockNode, { type: "tabs" }> {
	return {
		type: "tabs",
		id: "tabs-id",
		defaultValue: contents[0][0],
		tabs: contents.map(([value, children]) => ({
			id: `tabs-id>${value}`,
			value,
			label: value,
			children,
		})),
	};
}

function tree(...children: BlockNode[]): DocumentTree {
	return { schemaVersion: 1, metadata: { openGraph: [] }, toc: [], children };
}

function badge(props: Record<string, string>, children: InlineNode[]): InlineNode {
	return { type: "component", id: null, name: "Badge", props, children };
}

describe("collectTreeBlocks", () => {
	it("makes one item block of a tight item", () => {
		const inner = paragraph("tight ", { type: "strong", children: [text("item")] });
		const { blocks } = collectTreeBlocks(tree(list([inner])));
		expect(blocks).toHaveLength(1);
		expect(blocks[0].kind).toBe("item");
		expect(blocks[0].key).toBe(inner.children);
		expect(blocks[0].text).toBe("tight item");
	});

	it("makes a paragraph block of each paragraph of a loose item", () => {
		const first = paragraph("one");
		const second = paragraph("two");
		const { blocks } = collectTreeBlocks(tree(list([first, second])));
		expect(blocks.map((block) => [block.kind, block.text])).toEqual([
			["paragraph", "one"],
			["paragraph", "two"],
		]);
		expect(blocks[0].key).toBe(first.children);
	});

	it("takes no block for the paragraph of an item that holds a nested list", () => {
		const nested = paragraph("inner");
		const { blocks } = collectTreeBlocks(tree(list([paragraph("outer"), list([nested])])));
		expect(blocks.map((block) => block.text)).toEqual(["inner"]);
		expect(blocks[0].kind).toBe("item");
		expect(blocks[0].key).toBe(nested.children);
	});

	it("joins the text around a break without a gap", () => {
		const { blocks } = collectTreeBlocks(tree(paragraph("a", { type: "break" }, "b")));
		expect(blocks[0].nodes).toEqual(["a", "b"]);
		expect(blocks[0].text).toBe("ab");
	});

	it("gives a footnote reference its number and no source", () => {
		const reference: InlineNode = { type: "footnoteReference", label: "note" };
		const { blocks } = collectTreeBlocks(
			tree(paragraph("see", reference), {
				type: "footnoteDefinition",
				label: "note",
				children: [paragraph("body")],
			}),
		);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].nodes).toEqual(["see", "1"]);
		expect(blocks[0].sources[1]).toBeNull();
	});

	it("falls back to a question mark for a reference with no number", () => {
		const { blocks } = collectTreeBlocks(
			tree(paragraph({ type: "footnoteReference", label: "nope" })),
		);
		expect(blocks[0].nodes).toHaveLength(1);
		expect(blocks[0].sources).toEqual([null]);
		expect(["1", "?"]).toContain(blocks[0].nodes[0]);
	});

	it("gives a code block one string and leaves a Mermaid block out", () => {
		const typed = code("const a = 1;\n", "ts");
		const { blocks } = collectTreeBlocks(tree(typed, code("graph TD", "mermaid")));
		expect(blocks).toHaveLength(1);
		expect(blocks[0].kind).toBe("code");
		expect(blocks[0].key).toBe(typed);
		expect(blocks[0].nodes).toEqual(["const a = 1;\n"]);
		expect(blocks[0].sources).toEqual([typed]);
	});

	it("walks a tab's content with its tab steps and gives its heading the tabs as container", () => {
		const inside = paragraph("in tab");
		const nestedSection = section("Tabbed", inside);
		const outer = tabs(["one", [nestedSection]], ["two", [paragraph("other")]]);
		const { blocks } = collectTreeBlocks(tree(section("Top", outer)));
		expect(blocks.map((block) => block.text)).toEqual(["Top", "Tabbed", "in tab", "other"]);
		expect(blocks[0].tabSteps).toEqual([]);
		expect(blocks[1].tabSteps).toEqual([{ tabsId: "tabs-id", value: "one" }]);
		expect(blocks[2].tabSteps).toEqual([{ tabsId: "tabs-id", value: "one" }]);
		expect(blocks[3].tabSteps).toEqual([{ tabsId: "tabs-id", value: "two" }]);
		expect(blocks[1].container).toBe(outer);
		expect(blocks[2].container).toBe(outer);
	});

	it("makes a cell block of each header and body cell, in order", () => {
		const head = [[text("H1")], [text("H2")]];
		const rows = [
			[[text("a")], [text("b")]],
			[[text("c")], [text("d")]],
		];
		const table: BlockNode = {
			type: "table",
			id: "table",
			persist: true,
			align: [],
			head,
			rows,
		};
		const { blocks } = collectTreeBlocks(tree(table));
		expect(blocks.map((block) => [block.kind, block.text])).toEqual([
			["cell", "H1"],
			["cell", "H2"],
			["cell", "a"],
			["cell", "b"],
			["cell", "c"],
			["cell", "d"],
		]);
		expect(blocks[2].key).toBe(rows[0][0]);
		expect(blocks.every((block) => block.container === table)).toBe(true);
	});

	it("reads a Badge from its children, or from a string children prop", () => {
		const { blocks } = collectTreeBlocks(
			tree(
				paragraph(badge({}, [text("kids")]), " ", badge({ children: "prop" }, [])),
				paragraph({ type: "component", id: null, name: "Other", props: {}, children: [text("x")] }),
			),
		);
		expect(blocks[0].nodes).toEqual(["kids", " ", "prop"]);
		expect(blocks[0].sources[2]).toBeNull();
		expect(blocks[1].nodes).toEqual([]);
	});

	it("keys a heading by its text and numbers sections from zero", () => {
		const first = section("Alpha  Beta", paragraph("one"), section("Inner", paragraph("two")));
		const second = section("Gamma", paragraph("three"));
		const result = collectTreeBlocks(tree(paragraph("before"), first, second));
		expect(result.blocks.map((block) => [block.text, block.section])).toEqual([
			["before", -1],
			["Alpha Beta", 0],
			["one", 0],
			["Inner", 1],
			["two", 1],
			["Gamma", 2],
			["three", 2],
		]);
		expect(result.blocks[1].kind).toBe("heading");
		expect(result.blocks[1].key).toBe(first.heading);
		expect(result.blocks[1].container).toBe(first);
		expect(result.blocks[3].container).toBe(first.children[1]);
		expect(result.blocks[2].container).toBe(first.children[0]);
		expect(result.index.headings).toEqual([
			{ key: "Alpha Beta", block: 1 },
			{ key: "Inner", block: 3 },
			{ key: "Gamma", block: 5 },
		]);
	});

	it("finds a block's position by its key", () => {
		const inner = paragraph("find me");
		const result = collectTreeBlocks(tree(paragraph("first"), inner));
		expect(result.positionOf(inner.children)).toBe(1);
		expect(result.positionOf({})).toBeUndefined();
	});

	it("describes blocks with their section's heading key, null before the first heading", () => {
		const { descriptions } = collectTreeBlocks(
			tree(paragraph("before"), section("Heading", paragraph("after"))),
		);
		expect(descriptions).toEqual([
			{ heading: null, nodes: ["before"] },
			{ heading: "Heading", nodes: ["Heading"] },
			{ heading: "Heading", nodes: ["after"] },
		]);
	});

	it("leaves out footnote definitions and thematic breaks", () => {
		const { blocks } = collectTreeBlocks(
			tree(
				{ type: "thematicBreak" },
				{ type: "footnoteDefinition", label: "a", children: [paragraph("x")] },
				{ type: "error", id: "e", message: "bad", source: "src" },
			),
		);
		expect(blocks).toEqual([]);
	});
});
