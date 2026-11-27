import { describe, expect, it } from "vitest";
import {
	captureAnchor,
	headingKey,
	mapNormalizedRange,
	normalizeText,
	normalizeWithMap,
	resolveAnchor,
	resolutionPosition,
	type BlockDescription,
	type ResolveIndex,
} from "../comments/anchor";

function indexOf(sections: Array<{ heading: string | null; blocks: string[] }>): ResolveIndex {
	const headings: ResolveIndex["headings"][number][] = [];
	const blocks: ResolveIndex["blocks"][number][] = [];
	for (const section of sections) {
		let sectionIndex = -1;
		if (section.heading !== null) {
			headings.push({ key: headingKey(section.heading), block: blocks.length });
			sectionIndex = headings.length - 1;
			blocks.push({ text: normalizeText(section.heading), section: sectionIndex });
		}
		for (const text of section.blocks)
			blocks.push({ text: normalizeText(text), section: sectionIndex });
	}
	return { headings, blocks };
}

describe("normalizeText", () => {
	it("collapses whitespace runs and trims", () => {
		expect(normalizeText("  a \n\t b  ")).toBe("a b");
		expect(normalizeText("")).toBe("");
	});
});

describe("mapNormalizedRange", () => {
	it("maps across text nodes", () => {
		const nodes = ["Run the ", "installer", ", then restart"];
		const text = normalizeWithMap(nodes).text;
		const start = text.indexOf("installer");
		expect(mapNormalizedRange(nodes, start, start + "installer, then".length)).toEqual({
			start: { node: 1, offset: 0 },
			end: { node: 2, offset: 6 },
		});
	});

	it("maps collapsed whitespace back to the first raw whitespace character", () => {
		const nodes = ["a  \n", "  b"];
		expect(normalizeWithMap(nodes)).toEqual({ text: "a b", rawIndex: [0, 1, 6] });
		expect(mapNormalizedRange(nodes, 0, 3)).toEqual({
			start: { node: 0, offset: 0 },
			end: { node: 1, offset: 3 },
		});
	});

	it("returns null for empty or out-of-range spans", () => {
		expect(mapNormalizedRange(["abc"], 1, 1)).toBeNull();
		expect(mapNormalizedRange(["abc"], 0, 4)).toBeNull();
		expect(mapNormalizedRange([], 0, 1)).toBeNull();
	});
});

describe("captureAnchor", () => {
	const blocks: BlockDescription[] = [
		{ heading: null, nodes: ["Intro text."] },
		{ heading: "Installation", nodes: ["Run the installer, ", "then  restart", " your shell."] },
	];

	it("captures heading, block and quote", () => {
		const anchor = captureAnchor(blocks, {
			blockIndex: 1,
			start: { node: 1, offset: 0 },
			end: { node: 1, offset: 13 },
		});
		expect(anchor).toEqual({
			heading: "Installation",
			block: "Run the installer, then restart your shell.",
			quote: "then restart",
		});
	});

	it("clips a selection that runs past the block", () => {
		const anchor = captureAnchor(blocks, {
			blockIndex: 1,
			start: { node: 0, offset: 8 },
			end: null,
		});
		expect(anchor?.quote).toBe("installer, then restart your shell.");
	});

	it("keeps a null heading", () => {
		const anchor = captureAnchor(blocks, {
			blockIndex: 0,
			start: { node: 0, offset: 0 },
			end: { node: 0, offset: 5 },
		});
		expect(anchor?.heading).toBeNull();
	});

	it("returns null for whitespace-only or empty selections", () => {
		expect(
			captureAnchor([{ heading: null, nodes: ["a   b"] }], {
				blockIndex: 0,
				start: { node: 0, offset: 1 },
				end: { node: 0, offset: 4 },
			}),
		).toBeNull();
		expect(
			captureAnchor(blocks, {
				blockIndex: 0,
				start: { node: 0, offset: 3 },
				end: { node: 0, offset: 3 },
			}),
		).toBeNull();
		expect(
			captureAnchor(blocks, { blockIndex: 9, start: { node: 0, offset: 0 }, end: null }),
		).toBeNull();
	});

	it("keeps the last 500 characters of a long block and cuts a long quote", () => {
		const long = "word ".repeat(300).trim();
		const anchor = captureAnchor([{ heading: null, nodes: [long] }], {
			blockIndex: 0,
			start: { node: 0, offset: 0 },
			end: null,
		});
		expect(anchor?.block.length).toBeLessThanOrEqual(500);
		expect(long.endsWith(anchor?.block ?? "?")).toBe(true);
		expect(anchor?.quote.length).toBeLessThanOrEqual(500);
		expect(long.startsWith(anchor?.quote ?? "?")).toBe(true);
	});
});

describe("resolveAnchor", () => {
	const index = indexOf([
		{ heading: null, blocks: ["Preface paragraph."] },
		{ heading: "Installation", blocks: ["Run the installer, then restart your shell.", "Done."] },
		{ heading: "Usage", blocks: ["Run the installer, then restart your shell."] },
	]);

	it("is exact when the quote is in the block", () => {
		const resolution = resolveAnchor(
			{ heading: "Installation", block: "restart your shell.", quote: "then restart" },
			index,
		);
		expect(resolution).toEqual({ state: "exact", block: 2, start: 19, end: 31 });
	});

	it("normalizes a hand-written anchor before comparing", () => {
		const resolution = resolveAnchor(
			{ heading: "Install\n guide", block: "Run  the\ninstaller now.", quote: " the\n installer" },
			indexOf([{ heading: "Install guide", blocks: ["Run the installer now."] }]),
		);
		expect(resolution).toEqual({ state: "exact", block: 1, start: 4, end: 17 });
	});

	it("highlights the first occurrence of a repeated quote", () => {
		const repeated = indexOf([{ heading: "A", blocks: ["go go go"] }]);
		expect(resolveAnchor({ heading: "A", block: "go go go", quote: "go" }, repeated)).toMatchObject(
			{
				state: "exact",
				start: 0,
				end: 2,
			},
		);
	});

	it("falls back to the whole block when the quote is gone", () => {
		expect(
			resolveAnchor({ heading: "Installation", block: "Done.", quote: "finished" }, index),
		).toEqual({ state: "block", block: 3 });
	});

	it("falls back to the section heading when the block is gone", () => {
		const resolution = resolveAnchor(
			{ heading: "Installation", block: "Something else", quote: "else" },
			index,
		);
		expect(resolution).toEqual({ state: "section", block: 1 });
		expect(resolutionPosition(resolution)).toBe(1);
	});

	it("is detached when no heading matches", () => {
		const resolution = resolveAnchor({ heading: "Gone", block: "x", quote: "x" }, index);
		expect(resolution).toEqual({ state: "detached" });
		expect(resolutionPosition(resolution)).toBe(Infinity);
	});

	it("searches the null section from the start of the article to the first heading", () => {
		expect(
			resolveAnchor({ heading: null, block: "Preface paragraph.", quote: "Preface" }, index),
		).toMatchObject({ state: "exact", block: 0 });
		// Text that only exists under a heading is not in the null section.
		expect(resolveAnchor({ heading: null, block: "Done.", quote: "Done" }, index)).toEqual({
			state: "section",
			block: -1,
		});
	});

	it("searches duplicate headings in document order", () => {
		const duplicated = indexOf([
			{ heading: "Notes", blocks: ["first"] },
			{ heading: "Notes", blocks: ["second"] },
		]);
		expect(
			resolveAnchor({ heading: "Notes", block: "second", quote: "second" }, duplicated),
		).toMatchObject({
			state: "exact",
			block: 3,
		});
		// Not found anywhere: attaches to the first matching heading.
		expect(resolveAnchor({ heading: "Notes", block: "third", quote: "third" }, duplicated)).toEqual(
			{
				state: "section",
				block: 0,
			},
		);
	});

	it("matches a heading longer than the schema limit by its cut form", () => {
		const longHeading = "h".repeat(400);
		const long = indexOf([{ heading: longHeading, blocks: ["body"] }]);
		expect(
			resolveAnchor({ heading: headingKey(longHeading), block: "body", quote: "body" }, long).state,
		).toBe("exact");
	});
});
