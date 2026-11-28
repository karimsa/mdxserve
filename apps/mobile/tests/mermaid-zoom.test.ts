import { describe, expect, it } from "@jest/globals";
import * as fc from "fast-check";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAX_ZOOM, ZOOM_STEP } from "../src/diagram/render-call";

// The diagram page's zoom state (scripts/diagram-page/zoom.js), run as the page runs it.

interface ZoomState {
	scale: number;
	centerX: number;
	centerY: number;
}

const source = readFileSync(path.join(__dirname, "../scripts/diagram-page/zoom.js"), "utf8");
// eslint-disable-next-line no-new-func -- loading the page's own script is the point
const page = new Function(
	`${source}; return { zoom: mdxserveZoom, limits: MDXSERVE_ZOOM_LIMITS };`,
)() as {
	zoom: (state: ZoomState, action: unknown) => ZoomState;
	limits: { min: number; max: number; step: number };
};
const zoom = page.zoom;

const FITTED: ZoomState = { scale: 1, centerX: 0.5, centerY: 0.5 };

/** The part of the drawing on screen, in its box's units. */
function visible(state: ZoomState) {
	const half = 0.5 / state.scale;
	return {
		left: state.centerX - half,
		right: state.centerX + half,
		top: state.centerY - half,
		bottom: state.centerY + half,
	};
}

describe("the page's zoom", () => {
	it("uses the app's step and limit", () => {
		expect(page.limits).toEqual({ min: 1, max: MAX_ZOOM, step: ZOOM_STEP });
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

	it("never zooms out past fitted or in past ten times", () => {
		expect(zoom(FITTED, { kind: "zoom", factor: 0.5 })).toEqual(FITTED);
		expect(zoom({ scale: 9, centerX: 0.5, centerY: 0.5 }, { kind: "zoom", factor: 3 }).scale).toBe(
			10,
		);
	});

	it("pans within the drawing only", () => {
		const zoomed = zoom(FITTED, { kind: "zoom", factor: 2 });
		expect(zoom(zoomed, { kind: "pan", dx: 0.1, dy: -0.1 })).toEqual({
			scale: 2,
			centerX: 0.4,
			centerY: 0.6,
		});
		expect(zoom(zoomed, { kind: "pan", dx: 5, dy: 5 })).toEqual({
			scale: 2,
			centerX: 0.25,
			centerY: 0.25,
		});
		expect(zoom(FITTED, { kind: "pan", dx: 0.3, dy: 0.3 })).toEqual(FITTED);
	});

	it("resets to fitted", () => {
		expect(zoom({ scale: 4, centerX: 0.2, centerY: 0.9 }, { kind: "reset" })).toEqual(FITTED);
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

	it("for any sequence of actions, stays between fitted and ten times and shows only the drawing", () => {
		const unit = fc.double({ min: -2, max: 3, noNaN: true });
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
					expect(state.scale).toBeGreaterThanOrEqual(1);
					expect(state.scale).toBeLessThanOrEqual(10);
					const shown = visible(state);
					expect(shown.left).toBeGreaterThanOrEqual(-1e-9);
					expect(shown.top).toBeGreaterThanOrEqual(-1e-9);
					expect(shown.right).toBeLessThanOrEqual(1 + 1e-9);
					expect(shown.bottom).toBeLessThanOrEqual(1 + 1e-9);
				}
			}),
		);
	});

	it("keeps a focus inside the drawing still on screen when nothing is clamped", () => {
		fc.assert(
			fc.property(
				fc.double({ min: 1, max: 10, noNaN: true }),
				fc.double({ min: 0.5, max: 2, noNaN: true }),
				fc.double({ min: 0, max: 1, noNaN: true }),
				(scale, factor, focus) => {
					const before = { scale, centerX: 0.5, centerY: 0.5 };
					const after = zoom(before, { kind: "zoom", factor, focusX: focus, focusY: 0.5 });
					const target = Math.min(10, Math.max(1, scale * factor));
					expect(after.scale).toBeCloseTo(target, 9);
					// Where the focus sits on screen, as a share of the view's width from its left edge.
					const onScreen = (state: ZoomState) => (focus - visible(state).left) * state.scale;
					const clamped = visible(after).left <= 1e-9 || visible(after).right >= 1 - 1e-9;
					if (!clamped) expect(onScreen(after)).toBeCloseTo(onScreen(before), 6);
				},
			),
		);
	});
});
