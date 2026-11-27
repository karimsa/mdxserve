import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
	captureAnchor,
	headingKey,
	mapNormalizedRange,
	normalizeText,
	normalizeWithMap,
	resolveAnchor,
	type BlockDescription,
	type NodePoint,
	type ResolveIndex,
} from "../comments/anchor";

const piece = fc.constantFrom("a", "b", "word", " ", "  ", "\n", "\t", "é", "x y", "-");
const nodeText = fc.array(piece, { maxLength: 6 }).map((parts) => parts.join(""));
const nodeList = fc.array(nodeText, { minLength: 1, maxLength: 4 });
const word = fc.constantFrom("Alpha", "Beta", "Gamma", "Delta", "Alpha Beta");

interface TestDoc {
	blocks: BlockDescription[];
	index: ResolveIndex;
}

const docArbitrary: fc.Arbitrary<TestDoc> = fc
	.record({
		preface: fc.array(nodeList, { maxLength: 2 }),
		sections: fc.array(fc.record({ heading: word, blocks: fc.array(nodeList, { maxLength: 3 }) }), {
			maxLength: 3,
		}),
	})
	.map(({ preface, sections }) => {
		const blocks: BlockDescription[] = [];
		const headings: ResolveIndex["headings"][number][] = [];
		const resolveBlocks: ResolveIndex["blocks"][number][] = [];
		for (const nodes of preface) {
			blocks.push({ heading: null, nodes });
			resolveBlocks.push({ text: normalizeText(nodes.join("")), section: -1 });
		}
		for (const section of sections) {
			const key = headingKey(section.heading);
			headings.push({ key, block: blocks.length });
			const sectionIndex = headings.length - 1;
			blocks.push({ heading: key, nodes: [section.heading] });
			resolveBlocks.push({ text: normalizeText(section.heading), section: sectionIndex });
			for (const nodes of section.blocks) {
				blocks.push({ heading: key, nodes });
				resolveBlocks.push({ text: normalizeText(nodes.join("")), section: sectionIndex });
			}
		}
		return { blocks, index: { headings, blocks: resolveBlocks } };
	});

function pointAtRaw(nodes: string[], raw: number): NodePoint {
	let remaining = raw;
	for (let node = 0; node < nodes.length; node++) {
		if (remaining <= nodes[node].length) return { node, offset: remaining };
		remaining -= nodes[node].length;
	}
	return { node: nodes.length - 1, offset: nodes[nodes.length - 1].length };
}

describe("anchor properties", () => {
	it("capture then resolve on an unchanged doc is exact with the same quote", () => {
		fc.assert(
			fc.property(
				docArbitrary,
				fc.nat(),
				fc.nat(),
				fc.nat(),
				fc.boolean(),
				(doc, blockSeed, aSeed, bSeed, clip) => {
					fc.pre(doc.blocks.length > 0);
					const blockIndex = blockSeed % doc.blocks.length;
					const nodes = doc.blocks[blockIndex].nodes;
					const total = nodes.join("").length;
					const first = aSeed % (total + 1);
					const second = bSeed % (total + 1);
					const [low, high] = first <= second ? [first, second] : [second, first];
					const anchor = captureAnchor(doc.blocks, {
						blockIndex,
						start: pointAtRaw(nodes, low),
						end: clip ? null : pointAtRaw(nodes, high),
					});
					if (anchor === null) return;
					const resolution = resolveAnchor(anchor, doc.index);
					expect(resolution.state).toBe("exact");
					if (resolution.state !== "exact") return;
					const blockText = doc.index.blocks[resolution.block].text;
					expect(blockText.slice(resolution.start, resolution.end)).toBe(anchor.quote);
				},
			),
		);
	});

	it("maps normalized offsets back to the raw text they came from", () => {
		fc.assert(
			fc.property(nodeList, fc.nat(), fc.nat(), (nodes, aSeed, bSeed) => {
				const { text } = normalizeWithMap(nodes);
				expect(text).toBe(normalizeText(nodes.join("")));
				fc.pre(text.length > 0);
				const first = aSeed % text.length;
				const second = 1 + (bSeed % text.length);
				const [start, end] = first < second ? [first, second] : [second - 1, first + 1];
				const mapped = mapNormalizedRange(nodes, start, end);
				expect(mapped).not.toBeNull();
				if (!mapped) return;
				let raw = "";
				for (let node = mapped.start.node; node <= mapped.end.node; node++) {
					const from = node === mapped.start.node ? mapped.start.offset : 0;
					const to = node === mapped.end.node ? mapped.end.offset : nodes[node].length;
					raw += nodes[node].slice(from, to);
				}
				expect(raw.replace(/\s+/g, " ")).toBe(text.slice(start, end));
			}),
		);
	});

	it("never throws and never claims exact for a quote that is absent", () => {
		fc.assert(
			fc.property(docArbitrary, fc.string({ maxLength: 20 }), (doc, extra) => {
				const resolution = resolveAnchor(
					{ heading: null, block: "zz" + extra, quote: "zz" + extra },
					doc.index,
				);
				expect(resolution.state === "section" || resolution.state === "exact").toBe(true);
				if (resolution.state === "exact") {
					expect(doc.index.blocks[resolution.block].text.includes("zz" + extra)).toBe(true);
				}
			}),
		);
	});
});
