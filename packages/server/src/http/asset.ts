import type http from "node:http";
import path from "node:path";
import { z } from "zod";
import { AssetsService } from "../assets/service.js";
import type { RootInfo } from "../roots/root-info.js";
import { isSameOrigin } from "./host.js";
import { notFound, sendFile } from "./files.js";

/** The query of `GET /__mdxserve/getAsset`. Other query parameters are ignored. */
const getAssetInputSchema = z.object({
	path: z
		.string()
		.min(1)
		.max(4096)
		.refine((value) => path.isAbsolute(value), "path must be absolute"),
});

/**
 * Files in a root change while a page is open (a screenshot retaken), so a browser
 * revalidates each one, which costs a 304 when it did not change.
 */
const ASSET_CACHE = "no-cache";

/**
 * `getAsset`: serve one non-document file from a mounted root, the one endpoint whose
 * result is the file's bytes rather than JSON. `query` is the request's search params.
 * A restricted server applies the public reader's path rules. A request that names
 * another origin is refused, and the response may only be loaded by this origin's pages.
 */
export async function handleGetAsset(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	query: URLSearchParams,
	options: { roots: RootInfo[]; publicOnly: boolean },
): Promise<void> {
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.statusCode = 405;
		res.setHeader("Allow", "GET, HEAD");
		res.end();
		return;
	}
	const input = getAssetInputSchema.safeParse({ path: query.get("path") ?? undefined });
	if (!input.success) {
		res.statusCode = 400;
		res.setHeader("Content-Type", "text/plain; charset=utf-8");
		res.end(input.error.issues.map((issue) => issue.message).join("\n"));
		return;
	}
	await serveRootFile(req, res, input.data.path, options);
}

/**
 * Serve the file at absolute path `abs` from a mounted root, with the rules of
 * `AssetsService.locate`. A request for a root file at its own path (a link to a PDF
 * next to a document) is answered the same way as `getAsset`.
 */
export async function serveRootFile(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	abs: string,
	options: { roots: RootInfo[]; publicOnly: boolean },
): Promise<void> {
	if (!isSameOrigin(req.headers.origin, req.headers.host)) {
		res.statusCode = 403;
		res.end("Cross-origin request rejected");
		return;
	}
	const located = await new AssetsService(options.roots).locate(abs, options.publicOnly);
	if (located.kind !== "ok") {
		notFound(res);
		return;
	}
	res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
	sendFile(req, res, located, ASSET_CACHE);
}
