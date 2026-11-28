import { describe, expect, it } from "@jest/globals";
import * as fc from "fast-check";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from "../src/diagram/render-call";

// The diagram page's zoom state (scripts/diagram-page/zoom.js), run as the page runs it.

interface ZoomState {
	scale: number;
	centerX: number;
	centerY: number;
}

const source = readFileSync(path.join(__dirname, "../scripts/diagram-page/zoom.js"), "utf8");
// eslint-disable-next-line no-new-func -- loading the page's own script is the point
const page = new Function(
	`${source}; return { zoom: mdxserveZoom, fitted: mdxserveZoomFitted, limits: MDXSERVE_ZOOM_LIMITS };`,
)() as {
	zoom: (state: ZoomState, action: unknown) => ZoomState;
	fitted: (state: ZoomState) => boolean;
	limits: { min: number; max: number; step: number };
};
const zoom = page.zoom;

const FITTED: ZoomState = { scale: 1, centerX: 0.5, centerY: 0.5 };

/** The part of the drawing's box on screen, in its units. */
function visible(state: ZoomState) {
	const half = 0.5 / state.scale;
	return {
		left: state.centerX - half,
		right: state.centerX + half,
		top: state.centerY - half,
		bottom: state.centerY + half,
	};
}

/** How much of the drawing (the box from 0 to 1) is on screen along one axis. */
function overlap(from: number, to: number): number {
	return Math.max(0, Math.min(1, to) - Math.max(0, from));
}

describe("the page's zoom", () => {
	it("uses the app's step and limits", () => {
		expect(page.limits).toEqual({ min: MIN_ZOOM, max: MAX_ZOOM, step: ZOOM_STEP });
	});

	it("zooms about the middle from a control", () => {
		expect(zoom(FITTED, { kind: "zoom", factor: 2 })).toEqual({
			scale: 2,
			centerX: 0.5,
			centerY: 0.5,
		});
	});

	it("keeps a pinch's focus where it is", () => {
		const after = zoom(FITTED, { kind: "zoom", factor: 2, focusX: 0.25, focusY: 0.5 });
		expect(after).toEqual({ scale: 2, centerX: 0.375, centerY: 0.5 });
	});

	it("zooms out to a fifth of fitted and in to ten times, no further", () => {
		expect(zoom(FITTED, { kind: "zoom", factor: 0.5 }).scale).toBe(0.5);
		expect(zoom(FITTED, { kind: "zoom", factor: 0.01 }).scale).toBe(0.2);
		expect(zoom({ scale: 9, centerX: 0.5, centerY: 0.5 }, { kind: "zoom", factor: 3 }).scale).toBe(
			10,
		);
	});

	it("moves the drawing past its edges, even at fitted, until only a quarter is left", () => {
		// At 1× the drawing moves; a quarter of it stays on screen.
		expect(zoom(FITTED, { kind: "pan", dx: 0.3, dy: -0.3 })).toEqual({
			scale: 1,
			centerX: 0.2,
			centerY: 0.8,
		});
		expect(zoom(FITTED, { kind: "pan", dx: 5, dy: -5 })).toEqual({
			scale: 1,
			centerX: -0.25,
			centerY: 1.25,
		});
		// Zoomed in twice, a quarter of the screen stays on the drawing.
		const zoomed = zoom(FITTED, { kind: "zoom", factor: 2 });
		expect(zoom(zoomed, { kind: "pan", dx: 5, dy: 5 })).toEqual({
			scale: 2,
			centerX: -0.125,
			centerY: -0.125,
		});
	});

	it("knows the fitted, centred view, and resets to it", () => {
		expect(page.fitted(FITTED)).toBe(true);
		expect(page.fitted(zoom(FITTED, { kind: "pan", dx: 0.1, dy: 0 }))).toBe(false);
		expect(page.fitted(zoom(FITTED, { kind: "zoom", factor: 1.3 }))).toBe(false);
		expect(zoom({ scale: 4, centerX: -0.2, centerY: 1.1 }, { kind: "reset" })).toEqual(FITTED);
	});

	it.each([
		null,
		"zoom",
		{ kind: "zoom", factor: Number.NaN },
		{ kind: "zoom", factor: 0 },
		{ kind: "zoom", factor: -2 },
		{ kind: "pan", dx: Number.POSITIVE_INFINITY, dy: 0 },
		{ kind: "spin" },
	])("ignores %p", (action) => {
		const state = { scale: 3, centerX: 0.4, centerY: 0.6 };
		expect(zoom(state, action)).toBe(state);
	});

	it("for any sequence of actions, stays within its limits and never loses the drawing", () => {
		const unit = fc.double({ min: -5, max: 5, noNaN: true });
		const action = fc.oneof(
			fc.constant({ kind: "reset" }),
			fc.record({
				kind: fc.constant("zoom"),
				factor: fc.double({ min: 0.01, max: 20, noNaN: true }),
			}),
			fc.record({
				kind: fc.constant("zoom"),
				factor: fc.double({ min: 0.01, max: 20, noNaN: true }),
				focusX: unit,
				focusY: unit,
			}),
			fc.record({ kind: fc.constant("pan"), dx: unit, dy: unit }),
		);
		fc.assert(
			fc.property(fc.array(action, { maxLength: 30 }), (actions) => {
				let state = FITTED;
				for (const next of actions) {
					state = zoom(state, next);
					expect(state.scale).toBeGreaterThanOrEqual(0.2);
					expect(state.scale).toBeLessThanOrEqual(10);
					// A quarter of the drawing, or of the screen when zoomed in past it, stays in view.
					const keep = 0.25 * Math.min(1, 1 / state.scale) - 1e-9;
					const shown = visible(state);
					expect(overlap(shown.left, shown.right)).toBeGreaterThanOrEqual(keep);
					expect(overlap(shown.top, shown.bottom)).toBeGreaterThanOrEqual(keep);
				}
				expect(zoom(state, { kind: "reset" })).toEqual(FITTED);
			}),
		);
	});

	it("keeps a pinch's focus still on screen when nothing is held back", () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0.2, max: 10, noNaN: true }),
				fc.double({ min: 0.5, max: 2, noNaN: true }),
				fc.double({ min: 0, max: 1, noNaN: true }),
				(scale, factor, focus) => {
					const before = { scale, centerX: 0.5, centerY: 0.5 };
					const after = zoom(before, { kind: "zoom", factor, focusX: focus, focusY: 0.5 });
					const target = Math.min(10, Math.max(0.2, scale * factor));
					expect(after.scale).toBeCloseTo(target, 9);
					const onScreen = (state: ZoomState) => (focus - visible(state).left) * state.scale;
					const keep = 0.25 * Math.min(1, 1 / after.scale);
					const held = overlap(visible(after).left, visible(after).right) <= keep + 1e-9;
					if (!held) expect(onScreen(after)).toBeCloseTo(onScreen(before), 6);
				},
			),
		);
	});
});
