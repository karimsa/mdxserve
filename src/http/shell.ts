import path from "node:path";
import { renderDocument, escapeHtml } from "./html.js";
import type { FolderListing } from "../listing/folder.js";
import type { RootInfo } from "../roots/root-info.js";

export type Route =
	| { kind: "home"; roots: RootInfo[] }
	| ({ kind: "listing" } & FolderListing)
	| { kind: "doc"; path: string; rootName: string; rootDir: string; mtime?: number }
	| { kind: "notfound"; path: string; rootName?: string; rootDir?: string };

// Route JSON is embedded inside an inline <script type="application/json">.
// Escape "</" and "<!--" so nothing in a file/dir name (or the JSON itself)
// can break out of the script tag or be misparsed as an HTML comment. Also
// used by src/export/html.ts for its own inline route JSON and JS payload.
export function escapeForInlineScript(json: string): string {
	return json.replaceAll("</", "<\\/").replaceAll("<!--", "<\\!--");
}

function titleFor(route: Route): string {
	switch (route.kind) {
		case "home":
			return "mdxserve";
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
export function renderShell(
	route: Route,
	entrySrc = "/__mdxserve/entry.tsx",
	rootCount = 1,
): string {
	const routeJson = escapeForInlineScript(JSON.stringify(route));

	// The root count rides along so the client knows whether to show
	// multi-root navigation before the tree API has answered.
	const body = `    <div id="root"></div>
    <script id="__mdxserve_route" type="application/json" data-root-count="${rootCount}">${routeJson}</script>
    <script type="module" src="${escapeHtml(entrySrc)}"></script>`;

	return renderDocument({ title: titleFor(route), body });
}
