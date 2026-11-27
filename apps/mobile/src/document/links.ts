import { pathFromSegments, pathSegments } from "../library/paths";

/** Where a link in a document leads, in the app's terms. */
export type LinkTarget =
	/** A node of the open document: `#heading`, or a link to this same file with a fragment. */
	| { kind: "here"; fragment: string }
	/** Another document on the same server, with the fragment to reveal there ("" for none). */
	| { kind: "document"; path: string; fragment: string }
	| { kind: "folder"; path: string }
	/** Any other file in the server's roots: opened from its `getAsset` URL. */
	| { kind: "file"; path: string }
	| { kind: "web"; url: string }
	/** Nothing the app can open (an empty link, `javascript:`, a scheme it does not know). */
	| { kind: "none" };

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const OPENABLE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const DOCUMENT = /\.mdx?$/i;

function decode(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}

function splitFragment(text: string): { before: string; fragment: string } {
	const hash = text.indexOf("#");
	if (hash === -1) return { before: text, fragment: "" };
	return { before: text.slice(0, hash), fragment: decode(text.slice(hash + 1)) };
}

/**
 * Resolve a link's `href` in the document at `docPath` (an absolute path in the server's own
 * form), the way the web client resolves it against the page's URL, whose path is the file's:
 * a relative path joins the document's folder, `..` climbs, a path starting with `/` starts at
 * the file system's root, and a query is dropped.
 */
export function resolveLink(href: string, docPath: string): LinkTarget {
	const trimmed = href.trim();
	if (trimmed === "") return { kind: "none" };
	const scheme = SCHEME.exec(trimmed)?.[1]?.toLowerCase();
	// A Windows drive letter (`C:`) is a path, not a scheme.
	if (scheme !== undefined && !/^[a-z]:[\\/]/i.test(trimmed)) {
		return OPENABLE_SCHEMES.has(scheme) ? { kind: "web", url: trimmed } : { kind: "none" };
	}
	if (trimmed.startsWith("//")) return { kind: "web", url: `https:${trimmed}` };

	const { before, fragment } = splitFragment(trimmed);
	const pathPart = before.split("?")[0] ?? "";
	if (pathPart === "") return fragment === "" ? { kind: "none" } : { kind: "here", fragment };

	const absolute = pathPart.startsWith("/") || /^[a-z]:[\\/]/i.test(pathPart);
	const docSegments = pathSegments(docPath);
	const segments = absolute ? [] : docSegments.slice(0, -1);
	const written = pathPart.split(/[\\/]/);
	for (const raw of written) {
		const segment = decode(raw);
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			// A Windows path keeps its drive (or UNC share) when `..` climbs past it.
			if (segments.length > 1 || !/^([a-z]:|\\\\)/i.test(segments[0] ?? "")) segments.pop();
			continue;
		}
		segments.push(segment);
	}
	const path = pathFromSegments(segments);
	if (/[\\/]$/.test(pathPart)) return { kind: "folder", path };
	if (path === docPath) return { kind: "here", fragment };
	if (DOCUMENT.test(path)) return { kind: "document", path, fragment };
	return { kind: "file", path };
}
