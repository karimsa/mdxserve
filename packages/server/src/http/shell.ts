import fs from "node:fs";
import path from "node:path";
import { escapeHtml } from "./html.js";
import type { FolderListing } from "../listing/folder.js";
import type { RootInfo } from "../roots/root-info.js";
import type { PermissionMode } from "../servers/bind-host.js";
import type { DocumentMetadata } from "../docs/metadata.js";
import { missingBuildArtifact } from "../infra/pkg.js";

export type Route =
	| { kind: "home"; roots: RootInfo[] }
	| ({ kind: "listing" } & FolderListing)
	| {
			kind: "doc";
			path: string;
			rootName: string;
			rootDir: string;
			mtime?: number;
			metadata?: DocumentMetadata;
	  }
	| { kind: "notfound"; path: string; rootName?: string; rootDir?: string };

/** The two places in the built `index.html` (apps/web/src/index.html) the server fills per request. */
const MARKERS = ["head", "body"] as const;
type Marker = (typeof MARKERS)[number];

function markerOf(name: Marker): string {
	return `<!--mdxserve:${name}-->`;
}

/**
 * Read the built client's `index.html` from `clientDir` (`dist/client`), checking that it
 * carries each fill marker once. Throws when the client was never built.
 */
export function loadShellTemplate(clientDir: string): string {
	const file = path.join(clientDir, "index.html");
	let template: string;
	try {
		template = fs.readFileSync(file, "utf8");
	} catch {
		throw new Error(missingBuildArtifact("dist/client/index.html"));
	}
	for (const name of MARKERS) {
		if (template.split(markerOf(name)).length !== 2) {
			throw new Error(`mdxserve: ${file} must contain ${markerOf(name)} exactly once`);
		}
	}
	return template;
}

// Route JSON is embedded inside an inline <script type="application/json">.
// Escape "</" and "<!--" so nothing in a file/dir name (or the JSON itself)
// can break out of the script tag or be misparsed as an HTML comment.
function escapeForInlineScript(json: string): string {
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

function headTags(title: string, metadata: DocumentMetadata | undefined): string {
	const tags = [`<title>${escapeHtml(metadata?.title ?? title)}</title>`];
	if (metadata?.description !== undefined) {
		tags.push(
			`<meta data-mdxserve-metadata name="description" content="${escapeHtml(metadata.description)}" />`,
		);
	}
	if (metadata?.canonical !== undefined) {
		tags.push(
			`<link data-mdxserve-metadata rel="canonical" href="${escapeHtml(metadata.canonical)}" />`,
		);
	}
	for (const { property, content } of metadata?.openGraph ?? []) {
		tags.push(
			`<meta data-mdxserve-metadata property="${escapeHtml(property)}" content="${escapeHtml(content)}" />`,
		);
	}
	return tags.join("\n\t\t");
}

export interface ShellOptions {
	/** Mounted roots, so the client knows whether to show multi-root navigation before the tree API answers. */
	rootCount?: number;
	/** Whether the request came from this machine; the client shows same-machine actions from its first paint. */
	sameMachine?: boolean;
	permissions?: PermissionMode;
	metadata?: DocumentMetadata;
}

/**
 * Fill the built `index.html` for any route: the title and document metadata into the head,
 * and the route JSON the client boots from into the body. The view itself (listing, doc,
 * not-found) is rendered client-side. Each filled block stays between
 * `<!--mdxserve:<name>-->` and `<!--/mdxserve:<name>-->`, which the dev server
 * (apps/web/scripts/dev-shell.ts) reads to move them into the source page.
 */
export function renderShell(template: string, route: Route, options: ShellOptions = {}): string {
	const { rootCount = 1, sameMachine = false, permissions = "full", metadata } = options;
	const routeJson = escapeForInlineScript(
		JSON.stringify(route.kind === "doc" && metadata ? { ...route, metadata } : route),
	);
	const blocks: Record<Marker, string> = {
		head: headTags(titleFor(route), metadata),
		body: `<script id="__mdxserve_route" type="application/json" data-root-count="${rootCount}" data-same-machine="${sameMachine ? "1" : "0"}" data-permissions="${permissions}">${routeJson}</script>`,
	};
	let html = template;
	for (const name of MARKERS) {
		// A function replacement, so a `$` in a file name is never read as a pattern.
		html = html.replace(
			markerOf(name),
			() => `${markerOf(name)}${blocks[name]}<!--/mdxserve:${name}-->`,
		);
	}
	return html;
}
