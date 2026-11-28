import { describe, expect, it } from "@jest/globals";
import * as fc from "fast-check";
import {
	captureAnchor,
	mapNormalizedRange,
	normalizeText,
	resolveAnchor,
	type Resolution,
} from "@mdxserve/client/comments/anchor";
import { marksOf } from "@mdxserve/client/comments/marks";
import { collectTreeBlocks } from "@mdxserve/client/comments/tree-blocks";
import type { DocumentTree, InlineNode } from "@mdxserve/client/document/tree-types";
import { textOf } from "@mdxserve/ui/document/text-runs";
import { anchorFromSelection, blockRuns, type BlockText } from "../src/selection/block-runs";

/*
 * Over generated paragraphs: the runs show what the `Text` rendering shows, every unit maps back
 * to the block string it shows, and any selection becomes the anchor the web would make from
 * the same characters, which resolves exactly to that block.
 */

/** Characters that test the mapping: whitespace runs and soft breaks, emoji (surrogate pairs and
 * a skin tone), combining marks, right-to-left scripts, a no-break space. */
const CHARACTERS = [
	"a",
	"b",
	"Z",
	"1",
	" ",
	"  ",
	"\n",
	"\t",
	" \n ",
	" ",
	"👋",
	"👋🏽",
	"𝒳",
	"é",
	"ñ",
	"שלום",
	"مرحبا",
	"‏",
	".",
	",",
];

const textValue = fc
	.array(fc.constantFrom(...CHARACTERS), { minLength: 0, maxLength: 8 })
	.map((parts) => parts.join(""));

const leaf: fc.Arbitrary<InlineNode> = fc.oneof(
	{ weight: 5, arbitrary: textValue.map((value) => ({ type: "text", value }) as InlineNode) },
	{
		weight: 2,
		arbitrary: textValue.map((value) => ({ type: "inlineCode", value }) as InlineNode),
	},
	{ weight: 1, arbitrary: fc.constant({ type: "break" } as InlineNode) },
	{ weight: 1, arbitrary: fc.constant({ type: "footnoteReference", label: "one" } as InlineNode) },
);

const inline: fc.Arbitrary<InlineNode> = fc.letrec<{ node: InlineNode }>((tie) => ({
	node: fc.oneof(
		{ depthSize: "small", withCrossShrink: true },
		leaf,
		fc
			.tuple(
				fc.constantFrom("strong", "emphasis", "delete", "link"),
				fc.array(tie("node"), { maxLength: 3 }),
			)
			.map(([type, children]) =>
				type === "link"
					? ({ type, href: "https://example.com/", title: null, children } as InlineNode)
					: ({ type, children } as InlineNode),
			),
	),
})).node;

const paragraph = fc.array(inline, { minLength: 1, maxLength: 6 });

function documentOf(children: InlineNode[]): DocumentTree {
	return {
		schemaVersion: 1,
		metadata: { openGraph: [] },
		toc: [],
		children: [
			// A heading no paragraph's text can end with, so a paragraph's anchor never finds it.
			{
				type: "section",
				id: "head",
				level: 1,
				heading: [{ type: "text", value: "§" }],
				children: [{ type: "paragraph", children }],
			},
			{
				type: "footnoteDefinition",
				label: "one",
				children: [{ type: "paragraph", children: [{ type: "text", value: "Note." }] }],
			},
		],
	} as unknown as DocumentTree;
}

/** The text elements.tsx's `Text` draws for the nodes. */
function shown(nodes: readonly InlineNode[]): string {
	return nodes
		.map((node) => {
			switch (node.type) {
				case "text":
					return textOf(node.value);
				case "inlineCode":
					return node.value;
				case "break":
					return "\n";
				case "footnoteReference":
					return "[1]";
				case "emphasis":
				case "strong":
				case "delete":
				case "link":
					return shown(node.children);
				default:
					return "";
			}
		})
		.join("");
}

function setUp(children: InlineNode[], resolutions: ReadonlyMap<string, Resolution> = new Map()) {
	const tree = documentOf(children);
	const blocks = collectTreeBlocks(tree);
	const block = blocks.blocks[1];
	const marks = marksOf(blocks, resolutions);
	const text = blockRuns(block.key as InlineNode[], block, {
		marksOf: (source) => marks.get(source),
		activeThread: null,
	}) as BlockText;
	return { blocks, block, text };
}

/** A paragraph and a range of its shown text. */
const selected = paragraph.chain((children) => {
	const { text } = setUp(children);
	const length = text.text.length;
	return fc
		.tuple(fc.nat({ max: Math.max(length, 1) }), fc.nat({ max: Math.max(length, 1) }))
		.map(([one, two]) => ({
			children,
			start: Math.min(one, two, length),
			end: Math.min(Math.max(one, two), length),
		}));
});

describe("blockRuns over generated paragraphs", () => {
	it("shows what Text shows, with one map entry per UTF-16 unit, each pointing at the character it shows", () => {
		fc.assert(
			fc.property(paragraph, (children) => {
				const { block, text } = setUp(children);
				expect(text).not.toBeNull();
				expect(text.text).toBe(shown(children));
				expect(text.runs.map((run) => run.text).join("")).toBe(text.text);
				expect(text.map).toHaveLength(text.text.length);
				text.map.forEach((point, offset) => {
					if (point === null) return;
					const source = block.nodes[point.node][point.offset];
					const char = text.text[offset];
					if (char === " " && source !== " ") expect(source).toMatch(/[ \t\n\r\f]/);
					else expect(source).toBe(char);
				});
				// Every character of the block's strings that the web reads and is not collapsed away
				// is shown once.
				const mapped = text.map.filter((point) => point !== null);
				const keys = new Set(mapped.map((point) => `${point.node}:${point.offset}`));
				expect(keys.size).toBe(mapped.length);
			}),
			{ numRuns: 400 },
		);
	});

	it("shows the same text with any open thread's marks on it (marks never cut a run of whitespace)", () => {
		fc.assert(
			fc.property(selected, ({ children, start, end }) => {
				const plain = setUp(children);
				const normalized = plain.block.text;
				const from = Math.min(start, normalized.length);
				const to = Math.min(end, normalized.length);
				const range = mapNormalizedRange(plain.block.nodes, from, to);
				const anchor =
					range && captureAnchor(plain.blocks.descriptions, { blockIndex: 1, ...range });
				if (!anchor) return;
				const resolution = resolveAnchor(anchor, plain.blocks.index);
				const marked = setUp(children, new Map([["thread", resolution]]));
				expect(marked.text.text).toBe(plain.text.text);
				expect(marked.text.map).toEqual(plain.text.map);
			}),
			{ numRuns: 400 },
		);
	});

	it("turns any selection into the anchor of the characters it shows, which resolves exactly", () => {
		fc.assert(
			fc.property(selected, ({ children, start, end }) => {
				const { blocks, text } = setUp(children);
				const result = anchorFromSelection(text, blocks.descriptions, 1, {
					start,
					end,
					text: text.text.slice(start, end),
				});
				// The web's text of the same characters: the shown text without what the web has not.
				let web = "";
				for (let offset = start; offset < end; offset++)
					if (text.map[offset] !== null) web += text.text[offset];
				const quote = normalizeText(web);
				if (quote === "") {
					expect(result.kind).toBe("refused");
					return;
				}
				expect(result).toMatchObject({ kind: "ok", anchor: { heading: "§", quote } });
				if (result.kind !== "ok") return;
				const resolution = resolveAnchor(result.anchor, blocks.index);
				expect(resolution.state).toBe("exact");
				if (resolution.state !== "exact") return;
				expect(resolution.block).toBe(1);
				expect(blocks.blocks[1].text.slice(resolution.start, resolution.end)).toBe(quote);
			}),
			{ numRuns: 600 },
		);
	});

	it("never trusts offsets whose text is not the reported text", () => {
		fc.assert(
			fc.property(selected, fc.string(), ({ children, start, end }, reported) => {
				const { blocks, text } = setUp(children);
				fc.pre(text.text.slice(start, end) !== reported);
				const result = anchorFromSelection(text, blocks.descriptions, 1, {
					start,
					end,
					text: reported,
				});
				if (result.kind === "ok") expect(result.anchor.quote).toBe(normalizeText(reported));
			}),
			{ numRuns: 300 },
		);
	});
});
