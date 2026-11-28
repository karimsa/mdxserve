import { describe, expect, it } from "@jest/globals";
import { resolveAnchor } from "@mdxserve/client/comments/anchor";
import type { TextMark } from "@mdxserve/client/comments/marks";
import { collectTreeBlocks } from "@mdxserve/client/comments/tree-blocks";
import type { DocumentTree, InlineNode } from "@mdxserve/client/document/tree-types";
import {
	anchorFromSelection,
	blockRuns,
	runActions,
	type BlockText,
} from "../src/selection/block-runs";
import { layoutStyle, nativeRuns, type RunTheme } from "../src/selection/native-runs";

const text = (value: string) => ({ type: "text", value });
const code = (value: string) => ({ type: "inlineCode", value });

function documentOf(...children: unknown[]): DocumentTree {
	return {
		schemaVersion: 1,
		metadata: { openGraph: [] },
		toc: [],
		children: [
			{ type: "section", id: "guide", level: 1, heading: [text("Guide")], children },
			{
				type: "footnoteDefinition",
				label: "one",
				children: [{ type: "paragraph", children: [text("Note.")] }],
			},
		],
	} as unknown as DocumentTree;
}

const NO_MARKS = { marksOf: () => undefined, activeThread: null };

/** The tree's second block (the first is the heading), its runs, and the blocks. */
function paragraphOf(
	inline: unknown[],
	marks: {
		marksOf(source: object): readonly TextMark[] | undefined;
		activeThread: string | null;
	} = NO_MARKS,
) {
	const tree = documentOf({ type: "paragraph", children: inline });
	const blocks = collectTreeBlocks(tree);
	const block = blocks.blocks[1];
	const content = block.key as InlineNode[];
	return { tree, blocks, block, content, runs: blockRuns(content, block, marks) as BlockText };
}

/** What elements.tsx's `Text` shows for the same nodes. */
const TOUR = [
	text("The reader opens\na  document and "),
	{ type: "strong", children: [text("bold words")] },
	text(" then "),
	{ type: "link", href: "https://example.com/", title: null, children: [text("a link")] },
	text(" with "),
	code("chip"),
	text(" and "),
	code("a long  piece of code"),
	{ type: "break" },
	{ type: "emphasis", children: [{ type: "delete", children: [text("gone")] }] },
	{ type: "footnoteReference", label: "one" },
	text("."),
];

describe("blockRuns", () => {
	it("shows the text the Text rendering shows, soft line breaks and runs of spaces collapsed", () => {
		const { runs } = paragraphOf(TOUR);
		expect(runs.text).toBe(
			"The reader opens a document and bold words then a link with chip and a long  piece of code\ngone[1].",
		);
	});

	it("maps every shown unit to the block string it shows, and the break and brackets to nothing", () => {
		const { runs, block } = paragraphOf(TOUR);
		expect(runs.map).toHaveLength(runs.text.length);
		runs.map.forEach((point, offset) => {
			if (point === null) {
				expect(["\n", "[", "]"]).toContain(runs.text[offset]);
				return;
			}
			const shown = runs.text[offset];
			const source = block.nodes[point.node][point.offset];
			// A collapsed space stands for the first character of its run.
			expect(shown === " " ? /\s/.test(source) : source === shown).toBe(true);
		});
		// "opens\na": the space stands for the newline.
		const space = runs.text.indexOf("opens") + 5;
		expect(block.nodes[runs.map[space]!.node][runs.map[space]!.offset]).toBe("\n");
	});

	it("styles bold, links, code, emphasis inside strikethrough and the footnote", () => {
		const { runs } = paragraphOf(TOUR);
		const run = (value: string) => runs.runs.find((candidate) => candidate.text === value)!;
		expect(run("bold words").style).toMatchObject({ color: "heading", weight: "strong" });
		expect(run("a link").style.color).toBe("link");
		expect(run("a link").press).toEqual({ kind: "link", href: "https://example.com/" });
		expect(run("chip").style).toMatchObject({
			face: "mono",
			color: "accent",
			background: "code",
			rounded: true,
		});
		// Code with a space wraps: no chip, no background, as in the Text rendering.
		expect(run("a long  piece of code").style).toMatchObject({
			face: "mono",
			background: "none",
			rounded: false,
		});
		expect(run("gone").style).toMatchObject({ italic: true, strike: true });
		expect(run("[1]").style).toMatchObject({ color: "link", size: "footnote" });
		expect(run("[1]").press).toBeNull();
	});

	it("cuts a text node at its marks, and a mark inside a link keeps the link's press", () => {
		const inline = [
			text("alpha beta gamma "),
			{ type: "link", href: "/x", title: null, children: [text("linked")] },
		];
		const tree = documentOf({ type: "paragraph", children: inline });
		const blocks = collectTreeBlocks(tree);
		const block = blocks.blocks[1];
		const content = block.key as InlineNode[];
		const [plain, link] = [content[0], (content[1] as { children: object[] }).children[0]];
		const marks = new Map<object, TextMark[]>([
			[plain, [{ start: 6, end: 10, threadId: "one" }]],
			[link, [{ start: 0, end: 6, threadId: "two" }]],
		]);
		const runs = blockRuns(content, block, {
			marksOf: (source) => marks.get(source),
			activeThread: "two",
		})!;
		expect(runs.runs.map((run) => [run.text, run.style.background, run.press])).toEqual([
			["alpha ", "none", null],
			["beta", "mark", { kind: "mark", threadIds: ["one"] }],
			[" gamma ", "none", null],
			["linked", "active", { kind: "link", href: "/x" }],
		]);
		expect(runs.text).toBe("alpha beta gamma linked");
	});

	it("colours a chip covered by a mark with the mark", () => {
		const tree = documentOf({ type: "paragraph", children: [text("run "), code("npm")] });
		const blocks = collectTreeBlocks(tree);
		const block = blocks.blocks[1];
		const content = block.key as InlineNode[];
		const runs = blockRuns(content, block, {
			marksOf: (source) =>
				source === content[1] ? [{ start: 0, end: 3, threadId: "one" }] : undefined,
			activeThread: null,
		})!;
		expect(runs.runs[1].style).toMatchObject({ background: "mark", rounded: true });
	});

	it("is null for a block holding an image, a builtin or an HTML element", () => {
		for (const inline of [
			[text("an "), { type: "image", src: "/a.png", alt: "a", title: null }],
			[
				text("a "),
				{ type: "component", id: null, name: "Badge", props: {}, children: [text("badge")] },
			],
			[text("a "), { type: "element", id: null, tag: "kbd", attrs: {}, children: [text("K")] }],
		]) {
			const { content, block } = paragraphOf(inline);
			expect(blockRuns(content, block, NO_MARKS)).toBeNull();
		}
	});

	it("maps a paragraph longer than a call can take arguments", () => {
		const long = "word ".repeat(200_000);
		const { runs } = paragraphOf([text(long)]);
		expect(runs.map).toHaveLength(long.length);
	});

	it("is null when the nodes are not the block's", () => {
		const { content } = paragraphOf([text("one")]);
		const other = paragraphOf([text("one")]).block;
		expect(blockRuns(content, other, NO_MARKS)).toBeNull();
	});
});

describe("runActions", () => {
	it("gives each link and highlight one VoiceOver action, reporting its first run", () => {
		const inline = [
			text("see "),
			{
				type: "link",
				href: "/a",
				title: null,
				children: [text("the "), { type: "strong", children: [text("docs")] }],
			},
			text(" and "),
			{ type: "link", href: "/b", title: null, children: [text("more")] },
			text(" here"),
		];
		const tree = documentOf({ type: "paragraph", children: inline });
		const blocks = collectTreeBlocks(tree);
		const block = blocks.blocks[1];
		const content = block.key as InlineNode[];
		const last = content[4];
		const runs = blockRuns(content, block, {
			marksOf: (source) => (source === last ? [{ start: 1, end: 5, threadId: "one" }] : undefined),
			activeThread: null,
		})!;
		expect(runActions(runs)).toEqual([
			{ name: "Open link: the docs", index: 1 },
			{ name: "Open link: more", index: 4 },
			{ name: "Show comment on: here", index: 6 },
		]);
	});
});

describe("anchorFromSelection", () => {
	it("captures the selected words, across bold, a link and a chip, as the web would", () => {
		const { runs, blocks, tree } = paragraphOf(TOUR);
		const start = runs.text.indexOf("document");
		const end = runs.text.indexOf("chip") + 4;
		const result = anchorFromSelection(runs, blocks.descriptions, 1, {
			start,
			end,
			text: runs.text.slice(start, end),
		});
		expect(result).toEqual({
			kind: "ok",
			anchor: {
				heading: "Guide",
				block: blocks.blocks[1].text,
				quote: "document and bold words then a link with chip",
			},
		});
		if (result.kind !== "ok") return;
		expect(resolveAnchor(result.anchor, collectTreeBlocks(tree).index)).toMatchObject({
			state: "exact",
			block: 1,
		});
	});

	it("quotes across a soft line break with one space, and drops a break and brackets at the ends", () => {
		const { runs, blocks } = paragraphOf(TOUR);
		const across = runs.text.indexOf("opens");
		expect(
			anchorFromSelection(runs, blocks.descriptions, 1, {
				start: across,
				end: across + 7,
				text: runs.text.slice(across, across + 7),
			}),
		).toMatchObject({ anchor: { quote: "opens a" } });
		const breakAt = runs.text.indexOf("\n");
		const end = runs.text.indexOf("]") + 1;
		expect(
			anchorFromSelection(runs, blocks.descriptions, 1, {
				start: breakAt,
				end,
				text: runs.text.slice(breakAt, end),
			}),
		).toMatchObject({ anchor: { quote: "gone1" } });
	});

	it("refuses a selection of only a break", () => {
		const { runs, blocks } = paragraphOf(TOUR);
		const breakAt = runs.text.indexOf("\n");
		expect(
			anchorFromSelection(runs, blocks.descriptions, 1, {
				start: breakAt,
				end: breakAt + 1,
				text: "\n",
			}),
		).toEqual({ kind: "refused", message: "This selection could not be turned into a comment." });
	});

	it("falls back to the reported text when the offsets do not match it, and refuses text not in the block", () => {
		const { runs, blocks } = paragraphOf(TOUR);
		expect(
			anchorFromSelection(runs, blocks.descriptions, 1, { start: 0, end: 3, text: "bold\nwords" }),
		).toMatchObject({ kind: "ok", anchor: { quote: "bold words" } });
		expect(
			anchorFromSelection(runs, blocks.descriptions, 1, { start: 0, end: 3, text: "elsewhere" }),
		).toMatchObject({ kind: "refused" });
		expect(
			anchorFromSelection(runs, blocks.descriptions, 1, { start: 5, end: 900, text: "x" }),
		).toMatchObject({ kind: "refused" });
	});
});

const THEME: RunTheme = {
	base: { fontFamily: "Manrope", fontWeight: 400, fontSize: 16.5, lineHeight: 28.38, color: 1 },
	strong: { fontWeight: 600, color: 2 },
	link: 3,
	code: { fontFamily: "JetBrains Mono", fontWeight: 500, fontSize: 13, color: 4, background: 5 },
	footnoteSize: 12,
	mark: 6,
	markActive: 7,
};

describe("nativeRuns", () => {
	it("gives each run the face, size, weight and colours of its classes", () => {
		const { runs } = paragraphOf(TOUR);
		const native = nativeRuns(runs, THEME);
		const run = (value: string) => native.find((candidate) => candidate.text === value)!;
		expect(run("bold words")).toMatchObject({ fontWeight: 600, color: 2, fontFamily: "Manrope" });
		expect(run("a link")).toMatchObject({ color: 3, pressable: true });
		expect(run("chip")).toMatchObject({
			fontFamily: "JetBrains Mono",
			fontSize: 13,
			fontWeight: 500,
			color: 4,
			backgroundColor: 5,
			rounded: true,
		});
		expect(run("[1]")).toMatchObject({ fontSize: 12, color: 3, pressable: false });
		expect(run("gone")).toMatchObject({ italic: true, strikethrough: true });
		expect(native.map((entry) => entry.text).join("")).toBe(runs.text);
		expect(layoutStyle(run("gone"))).toEqual({
			fontFamily: "Manrope",
			fontWeight: "400",
			fontSize: 16.5,
			fontStyle: "italic",
			textDecorationLine: "line-through",
		});
	});
});
