import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
	captureAnchor,
	mapNormalizedRange,
	normalizeText,
	resolveAnchor,
	type Resolution,
} from "../comments/anchor";
import { marksOf, splitByMarks, type TextMark } from "../comments/marks";
import { collectTreeBlocks } from "../comments/tree-blocks";
import { treeArbitrary } from "./comments-tree-arbitrary";

const markList = fc.array(
	fc
		.record({
			start: fc.integer({ min: -2, max: 12 }),
			end: fc.integer({ min: -2, max: 12 }),
			threadId: fc.constantFrom("one", "two", "three"),
		})
		.map((mark): TextMark => mark),
	{ maxLength: 5 },
);

function collapse(text: string): string {
	return text.replace(/[ \t\n\r\f]+/g, " ");
}

describe("splitByMarks properties", () => {
	it("cuts into ordered, disjoint pieces that cover the text, each with the marks over it", () => {
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 10 }), markList, (length, marks) => {
				const pieces = splitByMarks(length, marks);
				let cursor = 0;
				for (const piece of pieces) {
					expect(piece.start).toBe(cursor);
					expect(piece.end).toBeGreaterThan(piece.start);
					cursor = piece.end;
					const expected = marks
						.filter(
							(mark) => mark.end > mark.start && mark.start <= piece.start && mark.end >= piece.end,
						)
						.map((mark) => mark.threadId);
					expect([...piece.threadIds].sort()).toEqual(expected.sort());
				}
				expect(cursor).toBe(length);
			}),
		);
	});
});

describe("marksOf properties", () => {
	const scenario = fc.record({
		tree: treeArbitrary,
		blockSeed: fc.nat(),
		aSeed: fc.nat(),
		bSeed: fc.nat(),
		whole: fc.boolean(),
	});

	function resolutionFor(seed: {
		tree: Parameters<typeof collectTreeBlocks>[0];
		blockSeed: number;
		aSeed: number;
		bSeed: number;
		whole: boolean;
	}) {
		const blocks = collectTreeBlocks(seed.tree);
		const candidates = blocks.blocks.flatMap((block, position) => (block.text ? [position] : []));
		if (candidates.length === 0) return null;
		const blockIndex = candidates[seed.blockSeed % candidates.length];
		const { text, nodes } = blocks.blocks[blockIndex];
		const first = seed.aSeed % text.length;
		const second = 1 + (seed.bSeed % text.length);
		const [start, end] = first < second ? [first, second] : [second - 1, first + 1];
		const range = mapNormalizedRange(nodes, start, end);
		if (!range) return null;
		const anchor = captureAnchor(blocks.descriptions, { blockIndex, ...range });
		if (!anchor) return null;
		const resolution: Resolution = seed.whole
			? { state: "block", block: blockIndex }
			: resolveAnchor(anchor, blocks.index);
		return { blocks, anchor, resolution };
	}

	it("never changes what a source node reads once its pieces are collapsed", () => {
		fc.assert(
			fc.property(scenario, (seed) => {
				const found = resolutionFor(seed);
				fc.pre(found !== null);
				if (!found) return;
				const marks = marksOf(found.blocks, new Map([["thread", found.resolution]]));
				for (const [source, list] of marks) {
					const { value } = source as { value: string };
					const pieces = splitByMarks(value.length, list);
					expect(
						pieces.map((piece) => collapse(value.slice(piece.start, piece.end))).join(""),
					).toBe(collapse(value));
				}
			}),
		);
	});

	it("marks the quote's characters and no others when every string has a source", () => {
		fc.assert(
			fc.property(scenario, (seed) => {
				const found = resolutionFor({ ...seed, whole: false });
				fc.pre(found !== null);
				if (!found || found.resolution.state !== "exact") return;
				const block = found.blocks.blocks[found.resolution.block];
				fc.pre(block.sources.every((source) => source !== null));
				const marks = marksOf(found.blocks, new Map([["thread", found.resolution]]));
				let marked = "";
				block.sources.forEach((source, position) => {
					const list = marks.get(source as object) ?? [];
					for (const piece of splitByMarks(block.nodes[position].length, list))
						if (piece.threadIds.length > 0)
							marked += block.nodes[position].slice(piece.start, piece.end);
				});
				expect(normalizeText(marked)).toBe(found.anchor.quote);
			}),
		);
	});
});
