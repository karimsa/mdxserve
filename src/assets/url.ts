import path from "node:path";

/** Where the server answers `getAsset`, the endpoint that serves a non-document file from a root. */
export const GET_ASSET_PATH = "/__mdxserve/getAsset";

/**
 * The `getAsset` URL for the file at absolute path `absPath`, with an optional `#fragment`.
 * @internal Exported for its tests.
 */
export function getAssetUrl(absPath: string, fragment = ""): string {
	return `${GET_ASSET_PATH}?${new URLSearchParams({ path: absPath }).toString()}${fragment}`;
}

/**
 * The URL a document's reference to a file in its root loads from: the `getAsset` URL of the
 * file `relativePath` names, resolved against the directory of `docPath` the way a browser
 * resolves an image next to the page. A fragment is kept (an SVG view, a PDF page); a query
 * means nothing for a file on disk and is dropped. When `docPath` is not absolute there is
 * nothing to resolve against, so the path is returned as written.
 */
export function assetUrl(relativePath: string, docPath: string): string {
	if (!path.isAbsolute(docPath)) return relativePath;
	const split = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(relativePath);
	const pathPart = split?.[1] ?? relativePath;
	const fragment = split?.[3] ?? "";
	const relativeFile = pathPart.split("/").map(decodeSegment).join(path.sep);
	return getAssetUrl(path.resolve(path.dirname(docPath), relativeFile), fragment);
}

function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		// Not valid percent-encoding: take the characters as written.
		return segment;
	}
}
