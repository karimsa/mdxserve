import { describe, expect, it } from "@jest/globals";
import { bubblePosition, tooltipAnchor } from "@mdxserve/ui/builtins/Tooltip";

// Where the app's tooltip bubble goes: always inside the window, on the side asked for when it fits.

const WINDOW = { width: 390, height: 844 };
const HEIGHT = 40;

function inside(position: { left: number; top: number; width: number }) {
	return (
		position.left >= 12 &&
		position.left + position.width <= WINDOW.width - 12 &&
		position.top >= 12 &&
		position.top + HEIGHT <= WINDOW.height - 12
	);
}

describe("the tooltip bubble's position", () => {
	it("sits above the text by default, and below it when asked", () => {
		const anchor = { x: 100, y: 400, width: 60, height: 20 };
		expect(bubblePosition(anchor, "top", WINDOW, HEIGHT).top).toBe(400 - 6 - HEIGHT);
		expect(bubblePosition(anchor, "bottom", WINDOW, HEIGHT).top).toBe(400 + 20 + 6);
	});

	it("flips to the other side when the asked side has no room", () => {
		expect(
			bubblePosition({ x: 100, y: 810, width: 60, height: 20 }, "bottom", WINDOW, HEIGHT).top,
		).toBe(810 - 6 - HEIGHT);
		expect(
			bubblePosition({ x: 100, y: 20, width: 60, height: 20 }, "top", WINDOW, HEIGHT).top,
		).toBe(20 + 20 + 6);
	});

	it("stays inside the window wherever the text is", () => {
		for (const placement of ["top", "bottom", "left", "right"] as const)
			for (const y of [0, 10, 300, 790, 830])
				for (const x of [0, 150, 360]) {
					const position = bubblePosition(
						{ x, y, width: 30, height: 20 },
						placement,
						WINDOW,
						HEIGHT,
					);
					expect({ placement, x, y, inside: inside(position) }).toEqual({
						placement,
						x,
						y,
						inside: true,
					});
				}
	});
});

describe("what the tooltip bubble points at", () => {
	it("is the text's own box when it was measured", () => {
		const box = { x: 40, y: 300, width: 72, height: 20 };
		expect(tooltipAnchor(box, { pageX: 60, pageY: 310 })).toEqual(box);
	});

	it("is the touched line when the text has no box of its own (nested in another Text)", () => {
		expect(tooltipAnchor({ x: 0, y: 0, width: 0, height: 0 }, { pageX: 180, pageY: 420 })).toEqual({
			x: 180,
			y: 410,
			width: 0,
			height: 20,
		});
	});
});
