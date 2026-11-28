// The diagram page's zoom state, a pure function with no DOM: build.js puts it in the same
// script as page.js, which applies the state to the SVG's viewBox, and the app's tests run it
// as it is (tests/mermaid-zoom.test.ts).
//
// The state is the zoom factor over the fitted drawing (0.2 to 10, as the web's pan and zoom)
// and the centre of the visible part, in the drawing's own box from 0 to 1 on each axis. The
// drawing moves freely, past its own edges, as long as a quarter of it (or of the screen,
// when zoomed in further than that) stays in view, so it can never be lost; reset brings back
// the fitted, centred view.

/** The smallest and largest zoom, and the factor one press of zoom in or out applies. */
var MDXSERVE_ZOOM_LIMITS = { min: 0.2, max: 10, step: 1.3 };

/**
 * The zoom state after `action`: { kind: "reset" }, { kind: "zoom", factor, focusX?, focusY? }
 * (the focus, in the box's units, stays where it is on screen) or { kind: "pan", dx, dy } (in
 * the box's units). Anything else, or a non-finite number, leaves the state as it is.
 */
// oxlint-disable-next-line no-unused-vars -- page.js calls it: build.js puts both in one script.
function mdxserveZoom(state, action) {
	function finite(value) {
		return typeof value === "number" && isFinite(value);
	}
	/** The centre moved back just enough that a quarter of the drawing or the view overlaps. */
	function within(center, scale) {
		var half = 0.5 / scale;
		var keep = 0.25 * Math.min(1, 1 / scale);
		return Math.min(1 + half - keep, Math.max(-half + keep, center));
	}
	function settle(scale, centerX, centerY) {
		return { scale: scale, centerX: within(centerX, scale), centerY: within(centerY, scale) };
	}
	if (!action || typeof action !== "object") return state;
	if (action.kind === "reset") return { scale: 1, centerX: 0.5, centerY: 0.5 };
	if (action.kind === "zoom") {
		if (!finite(action.factor) || action.factor <= 0) return state;
		var focusX = finite(action.focusX) ? action.focusX : state.centerX;
		var focusY = finite(action.focusY) ? action.focusY : state.centerY;
		var scale = Math.min(
			MDXSERVE_ZOOM_LIMITS.max,
			Math.max(MDXSERVE_ZOOM_LIMITS.min, state.scale * action.factor),
		);
		var ratio = state.scale / scale;
		return settle(
			scale,
			focusX - (focusX - state.centerX) * ratio,
			focusY - (focusY - state.centerY) * ratio,
		);
	}
	if (action.kind === "pan") {
		if (!finite(action.dx) || !finite(action.dy)) return state;
		return settle(state.scale, state.centerX - action.dx, state.centerY - action.dy);
	}
	return state;
}

/** Whether `state` is the fitted, centred view that reset gives. */
// oxlint-disable-next-line no-unused-vars -- page.js calls it: build.js puts both in one script.
function mdxserveZoomFitted(state) {
	return state.scale === 1 && state.centerX === 0.5 && state.centerY === 0.5;
}
