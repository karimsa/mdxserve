/** What the app asks the diagram page to draw. */
export interface RenderRequest {
	/** Rises by one per request from one WebView, so a late answer can be told apart. */
	token: number;
	/** The text handed to Mermaid (after the narrow-window direction rule). */
	source: string;
	/** Mermaid's `themeVariables`. */
	themeVariables: Record<string, string>;
}

/**
 * The JavaScript the app injects to draw `request`. The request goes in as JSON, which is a
 * JavaScript expression, so no source text can leave the argument position.
 */
export function renderCall(request: RenderRequest): string {
	const json = JSON.stringify(request).replaceAll(" ", "\\u2028").replaceAll(" ", "\\u2029");
	return `window.mdxserveDiagram.render(${json});true;`;
}
