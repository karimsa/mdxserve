import path from "node:path";
import { renderDocument, escapeHtml } from "./html.js";
import type { ListingEntry } from "./listing.js";

export type Route =
	| { kind: "listing"; path: string; rootName: string; entries: ListingEntry[] }
	| { kind: "doc"; path: string; rootName: string }
	| { kind: "notfound"; path: string; rootName: string };

// Route JSON is embedded inside an inline <script type="application/json">.
// Escape "</" and "<!--" so nothing in a file/dir name (or the JSON itself)
// can break out of the script tag or be misparsed as an HTML comment.
function escapeForInlineScript(json: string): string {
	return json.replaceAll("</", "<\\/").replaceAll("<!--", "<\\!--");
}

function titleFor(route: Route): string {
	switch (route.kind) {
		case "listing": {
			const segments = route.path.split("/").filter(Boolean);
			return segments.length > 0 ? segments[segments.length - 1] : route.rootName;
		}
		case "doc":
			return path.basename(route.path);
		case "notfound":
			return "Not found";
	}
}

/**
 * Render the HTML shell for any route. The actual view (listing, doc,
 * not-found) is rendered client-side by the SPA, which reads the embedded
 * route JSON and boots from there.
 */
export function renderShell(route: Route, entrySrc = "/__mdxserve/entry.tsx"): string {
	const routeJson = escapeForInlineScript(JSON.stringify(route));

	const body = `    <div id="root"></div>
    <script id="__mdxserve_route" type="application/json">${routeJson}</script>
    <script type="module" src="${escapeHtml(entrySrc)}"></script>`;

	return renderDocument({ title: titleFor(route), body });
}
