import type http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { contentTypeOf, isActiveContentType } from "../assets/content-type.js";

/** Built client files are content-hashed, so a name never changes meaning. */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

export interface ServedFile {
	abs: string;
	size: number;
	mtimeMs: number;
	contentType: string;
}

export function notFound(res: http.ServerResponse): void {
	res.statusCode = 404;
	res.setHeader("Content-Type", "text/plain; charset=utf-8");
	res.end("Not found");
}

/**
 * Send one file for a GET or HEAD. A file that could run script when opened as a page
 * (HTML, SVG, XML) is sandboxed into an opaque origin, and nothing is type-sniffed.
 * `cacheControl` without `immutable` revalidates by ETag.
 */
export function sendFile(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	file: ServedFile,
	cacheControl: string,
): void {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.statusCode = 405;
		res.setHeader("Allow", "GET, HEAD");
		res.end();
		return;
	}
	const etag = `W/"${file.size.toString(16)}-${Math.floor(file.mtimeMs).toString(16)}"`;
	res.setHeader("Content-Type", file.contentType);
	res.setHeader("Cache-Control", cacheControl);
	res.setHeader("ETag", etag);
	res.setHeader("Last-Modified", new Date(file.mtimeMs).toUTCString());
	res.setHeader("X-Content-Type-Options", "nosniff");
	if (isActiveContentType(file.contentType)) res.setHeader("Content-Security-Policy", "sandbox");
	if (req.headers["if-none-match"] === etag) {
		res.statusCode = 304;
		res.end();
		return;
	}
	res.statusCode = 200;
	res.setHeader("Content-Length", file.size);
	if (req.method === "HEAD") {
		res.end();
		return;
	}
	const stream = fs.createReadStream(file.abs);
	stream.on("error", () => res.destroy());
	stream.pipe(res);
}

/** A built client file name under `assets/`: one segment, no hidden name. */
const ASSET_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * Serve `name` from the built client's `assets/` folder in `clientDir` with a one-year
 * immutable cache header, or 404 for anything else.
 */
export async function sendClientAsset(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	clientDir: string,
	name: string,
): Promise<void> {
	if (!ASSET_NAME.test(name)) {
		notFound(res);
		return;
	}
	const abs = path.join(clientDir, "assets", name);
	let stat;
	try {
		stat = await fsp.stat(abs);
	} catch {
		notFound(res);
		return;
	}
	if (!stat.isFile()) {
		notFound(res);
		return;
	}
	sendFile(
		req,
		res,
		{ abs, size: stat.size, mtimeMs: stat.mtimeMs, contentType: contentTypeOf(abs) },
		IMMUTABLE_CACHE,
	);
}
