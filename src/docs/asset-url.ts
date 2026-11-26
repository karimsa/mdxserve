import path from "node:path";
import { toPosix } from "../infra/paths.js";

/**
 * The URL the server serves a file in a mounted root at: its absolute path,
 * percent-encoded (`src/http/server.ts` hands a non-document file under a
 * root to Vite as a static asset). `relativePath` is resolved against the
 * directory of `docPath`, the way a browser resolves an image next to the
 * page; a query or fragment is kept. When `docPath` is not absolute there
 * is nothing to resolve against, so the path is returned as written.
 */
export function rootFileUrl(relativePath: string, docPath: string): string {
	if (!path.isAbsolute(docPath)) return relativePath;
	const split = /^([^?#]*)(.*)$/.exec(relativePath);
	const pathPart = split?.[1] ?? relativePath;
	const suffix = split?.[2] ?? "";
	let decoded = pathPart;
	try {
		decoded = decodeURI(pathPart);
	} catch {
		// Not valid percent-encoding: take the characters as written.
	}
	const absolute = toPosix(path.resolve(path.dirname(docPath), decoded));
	return encodeURI(absolute) + suffix;
}
