/** What the app asks the diagram page to draw. */
export interface RenderRequest {
	/** Rises by one per request from one WebView, so a late answer can be told apart. */
	token: number;
	/** The text handed to Mermaid (after the narrow-window direction rule). */
	source: string;
	/** Mermaid's `themeVariables`. */
	themeVariables: Record<string, string>;
}

/** A zoom control's change (scripts/diagram-page/zoom.js): one step in or out, or back to fit. */
export type ZoomAction = { kind: "zoom"; factor: number } | { kind: "reset" };

/** How much one press of zoom in multiplies the zoom by (as the web's svg-pan-zoom). */
export const ZOOM_STEP = 1.3;

/** The largest zoom the page allows. */
export const MAX_ZOOM = 10;

/** The smallest zoom the page allows: a fifth of fitted, as the web's. */
export const MIN_ZOOM = 0.2;

/**
 * `value` as a JavaScript expression: its JSON, parsed by the page. An object literal would turn
 * a `"__proto__"` key (a theme variable could be named so) into the object's prototype.
 */
function asArgument(value: unknown): string {
	const literal = JSON.stringify(JSON.stringify(value));
	return `JSON.parse(${literal.replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029")})`;
}

/** The JavaScript the app injects for a zoom control. */
export function zoomCall(action: ZoomAction): string {
	return `window.mdxserveDiagram.zoom(${asArgument(action)});true;`;
}

/**
 * The JavaScript the app injects to draw `request`. The request goes in as JSON, which is a
 * JavaScript expression, so no source text can leave the argument position.
 */
export function renderCall(request: RenderRequest): string {
	return `window.mdxserveDiagram.render(${asArgument(request)});true;`;
}
