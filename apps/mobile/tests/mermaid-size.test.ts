import { describe, expect, it } from "@jest/globals";
import * as fc from "fast-check";
import { inlineDiagramSize, UNMEASURED_HEIGHT } from "../src/diagram/size";
import { DiagramSizes } from "../src/diagram/sizes";

const FOLDED = 466;
const UNFOLDED = 951;
const WIDE = { width: 1200, height: 300 };
const TALL = { width: 300, height: 2400 };

describe("inlineDiagramSize", () => {
	it("scales a wide drawing down to the folded and unfolded widths", () => {
		expect(
			inlineDiagramSize({ natural: WIDE, available: FOLDED, maxHeight: 600, minHeight: 48 }),
		).toEqual({
			width: FOLDED,
			height: Math.ceil(300 * (FOLDED / 1200)),
		});
		expect(
			inlineDiagramSize({ natural: WIDE, available: UNFOLDED, maxHeight: 600, minHeight: 48 }),
		).toEqual({
			width: UNFOLDED,
			height: Math.ceil(300 * (UNFOLDED / 1200)),
		});
	});

	it("scales a tall drawing down to the height limit", () => {
		expect(
			inlineDiagramSize({ natural: TALL, available: FOLDED, maxHeight: 560, minHeight: 48 }),
		).toEqual({
			width: FOLDED,
			height: 560,
		});
	});

	it("never scales a small drawing up", () => {
		expect(
			inlineDiagramSize({
				natural: { width: 100, height: 80 },
				available: UNFOLDED,
				maxHeight: 600,
				minHeight: 48,
			}),
		).toEqual({ width: UNFOLDED, height: 80 });
	});

	it("keeps a minimum height", () => {
		expect(
			inlineDiagramSize({
				natural: { width: 4000, height: 20 },
				available: FOLDED,
				maxHeight: 600,
				minHeight: 48,
			}).height,
		).toBe(48);
	});

	it.each([
		{ natural: WIDE, available: 0, maxHeight: 600, minHeight: 48 },
		{ natural: WIDE, available: -5, maxHeight: 600, minHeight: 48 },
		{
			natural: { width: Number.NaN, height: 10 },
			available: FOLDED,
			maxHeight: 600,
			minHeight: 48,
		},
		{
			natural: { width: 10, height: Number.POSITIVE_INFINITY },
			available: FOLDED,
			maxHeight: 600,
			minHeight: 48,
		},
		{ natural: { width: 0, height: 10 }, available: FOLDED, maxHeight: 600, minHeight: 48 },
	])("gives the unmeasured box for degenerate input %#", (input) => {
		expect(inlineDiagramSize(input)).toEqual({ width: 0, height: UNMEASURED_HEIGHT });
	});

	it("fills the width, stays under the limit, never enlarges and keeps the aspect ratio", () => {
		const length = fc.double({ min: 1, max: 20_000, noNaN: true });
		fc.assert(
			fc.property(
				length,
				length,
				length,
				length,
				fc.integer({ min: 0, max: 400 }),
				(width, height, available, maxHeight, minHeight) => {
					const box = inlineDiagramSize({
						natural: { width, height },
						available,
						maxHeight,
						minHeight,
					});
					expect(box.width).toBe(available);
					expect(box.height).toBeGreaterThanOrEqual(minHeight);
					expect(box.height).toBeLessThanOrEqual(Math.max(minHeight, Math.ceil(maxHeight)));
					const scale = Math.min(1, available / width, maxHeight / height);
					expect(scale).toBeLessThanOrEqual(1);
					if (box.height > minHeight) {
						// The drawing is centred in the box at `scale`; its height is the box's within a point.
						expect(Math.abs(box.height - height * scale)).toBeLessThanOrEqual(1);
						expect(width * scale).toBeLessThanOrEqual(available + 1e-6);
					}
				},
			),
		);
	});
});

describe("DiagramSizes", () => {
	it("keeps the latest 200 sizes, dropping the oldest first", () => {
		const sizes = new DiagramSizes();
		for (let index = 0; index < 201; index += 1)
			sizes.set(`source ${index}`, { width: index + 1, height: 10 });
		expect(sizes.get("source 0")).toBeUndefined();
		expect(sizes.get("source 1")).toEqual({ width: 2, height: 10 });
		expect(sizes.get("source 200")).toEqual({ width: 201, height: 10 });
	});

	it("counts a size set again as the newest", () => {
		const sizes = new DiagramSizes();
		for (let index = 0; index < 200; index += 1)
			sizes.set(`source ${index}`, { width: 1, height: 1 });
		sizes.set("source 0", { width: 5, height: 5 });
		sizes.set("source 200", { width: 1, height: 1 });
		expect(sizes.get("source 0")).toEqual({ width: 5, height: 5 });
		expect(sizes.get("source 1")).toBeUndefined();
	});
});
