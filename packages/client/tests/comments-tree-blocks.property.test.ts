import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
	captureAnchor,
	mapNormalizedRange,
	normalizeText,
	resolveAnchor,
} from "../comments/anchor";
import { collectTreeBlocks } from "../comments/tree-blocks";
import { rowNodes, treeArbitrary } from "./comments-tree-arbitrary";

describe("collectTreeBlocks properties", () => {
	it("captures then resolves any range of a block's text to the same quote", () => {
		fc.assert(
			fc.property(treeArbitrary, fc.nat(), fc.nat(), fc.nat(), (tree, blockSeed, aSeed, bSeed) => {
				const { blocks, descriptions, index } = collectTreeBlocks(tree);
				const candidates = blocks.flatMap((block, position) => (block.text ? [position] : []));
				fc.pre(candidates.length > 0);
				const blockIndex = candidates[blockSeed % candidates.length];
				const { text, nodes } = blocks[blockIndex];
				const first = aSeed % text.length;
				const second = 1 + (bSeed % text.length);
				const [start, end] = first < second ? [first, second] : [second - 1, first + 1];
				const range = mapNormalizedRange(nodes, start, end);
				expect(range).not.toBeNull();
				if (!range) return;
				const anchor = captureAnchor(descriptions, { blockIndex, ...range });
				// A range of only a space has no quote to capture.
				fc.pre(text.slice(start, end).trim() !== "");
				expect(anchor).not.toBeNull();
				if (!anchor) return;
				expect(anchor.quote).toBe(text.slice(start, end).trim());
				const resolution = resolveAnchor(anchor, index);
				expect(resolution.state).toBe("exact");
				if (resolution.state !== "exact") return;
				const resolved = blocks[resolution.block];
				expect(resolved.text.endsWith(anchor.block)).toBe(true);
				expect(resolved.text.slice(resolution.start, resolution.end)).toBe(anchor.quote);
			}),
		);
	});

	it("normalizes a block's text from its strings", () => {
		fc.assert(
			fc.property(treeArbitrary, (tree) => {
				for (const block of collectTreeBlocks(tree).blocks)
					expect(block.text).toBe(normalizeText(block.nodes.join("")));
			}),
		);
	});

	it("gives every source node the value of its string", () => {
		fc.assert(
			fc.property(treeArbitrary, (tree) => {
				for (const block of collectTreeBlocks(tree).blocks) {
					expect(block.sources).toHaveLength(block.nodes.length);
					block.sources.forEach((source, position) => {
						if (source !== null)
							expect((source as { value: string }).value).toBe(block.nodes[position]);
					});
				}
			}),
		);
	});

	it("never moves a block to an earlier section", () => {
		fc.assert(
			fc.property(treeArbitrary, (tree) => {
				const { blocks } = collectTreeBlocks(tree);
				blocks.forEach((block, position) => {
					if (position > 0)
						expect(block.section).toBeGreaterThanOrEqual(blocks[position - 1].section);
				});
			}),
		);
	});

	it("draws every block in a row of the list", () => {
		fc.assert(
			fc.property(treeArbitrary, (tree) => {
				const rows = rowNodes(tree);
				for (const block of collectTreeBlocks(tree).blocks)
					expect(rows.has(block.container)).toBe(true);
			}),
		);
	});
});
