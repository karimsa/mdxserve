import type { DiagramsService } from "../diagrams/service.js";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import { ListingService } from "../listing/service.js";
import { renderShell, type Route } from "./shell.js";
import type { RootsService } from "../roots/service.js";
import { resolveRoot } from "../roots/paths.js";
import { isDocFile, isPublicPath } from "../roots/servable.js";
import type { Registry } from "../components/registry.js";
import { rootInfoFor } from "../roots/root-info.js";
import type { DocCache } from "../docs/doc-cache.js";
import type { SearchService } from "../search/service.js";
import type { DocsService } from "../docs/service.js";
import { appRouter } from "../api/router.js";
import { isTrustedHost } from "./host.js";
import { GET_ASSET_PATH } from "../assets/url.js";
import { handleGetAsset, serveRootFile } from "./asset.js";
import { notFound, sendClientAsset, sendFile } from "./files.js";
import type { PermissionMode } from "../servers/bind-host.js";
import type { DocumentMetadata } from "../docs/metadata.js";

const MDXSERVE_PREFIX = "/__mdxserve/";
/** Where the built client's `assets/` folder is served (Vite's `base` plus `assetsDir`). */
const CLIENT_ASSETS_PREFIX = "/__mdxserve/assets/";

/** The built browser client, read once at startup. */
export interface ClientBundle {
	/** `dist/client`: `index.html`, `favicon.svg` and `assets/`. */
	dir: string;
	/** The built `index.html`, filled per request by `renderShell`. */
	template: string;
}

// Browser navigations (typed URL, clicked link, redirect) send an Accept
// header that prefers text/html. A fetch of the same .md/.mdx path does not,
// so this is how we tell "serve the page shell" apart from a request for the
// file itself, which documents never answer.
function wantsHtml(req: http.IncomingMessage): boolean {
	const accept = req.headers.accept ?? "";
	return accept.includes("text/html");
}

export interface RequestContext {
	diagrams?: DiagramsService;
	/** Per-process state, created once in startServer: owns the mutable set of mounted roots. */
	roots: RootsService;
	registry: Registry;
	client: ClientBundle;
	/** Per-process state, created once in startServer. */
	docCache: DocCache;
	search: SearchService;
	/** Per-process state, created once in startServer: it owns the per-file save lock. */
	docs: DocsService;
	permissions?: PermissionMode;
}

export async function handleRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	ctx: RequestContext,
): Promise<void> {
	const { registry, docCache, search: searchService, docs } = ctx;
	const rootInfos = ctx.roots.list();
	const roots = rootInfos.map((rootInfo) => rootInfo.dir);
	const url = req.url ?? "/";
	const pathname = url.split("?")[0] ?? "/";
	const search = url.slice(pathname.length);
	const restricted = ctx.permissions === "restricted";

	// Serving pages to the LAN (--host 0.0.0.0) is deliberate sharing, but
	// remote peers shouldn't get the operations that act on this machine, such
	// as mounting roots, so those are reserved for same-machine callers.
	// "Same machine" is loopback, or a connection whose remote address is
	// this socket's own local address: the CLI connects to the host a
	// server registered (e.g. --host 192.168.1.10), which arrives
	// with the LAN address on both ends — something no other machine's
	// packet can present.
	// The Host header must name this machine too (see isTrustedHost): a
	// DNS-rebinding page reaches loopback from the browser but arrives with
	// its own domain in Host, and must not inherit same-machine privileges.
	const remoteAddress = req.socket.remoteAddress;
	const isLoopback =
		(remoteAddress === "127.0.0.1" ||
			remoteAddress === "::1" ||
			remoteAddress === "::ffff:127.0.0.1" ||
			(remoteAddress !== undefined && remoteAddress === req.socket.localAddress)) &&
		isTrustedHost(req.headers.host, req.socket.localAddress);
	const sameMachine = isLoopback && !restricted;
	const shell = (route: Route, metadata?: DocumentMetadata) =>
		renderShell(ctx.client.template, route, {
			rootCount: roots.length,
			sameMachine,
			permissions: ctx.permissions,
			metadata,
		});

	if (pathname === "/favicon.ico" || pathname === "/__mdxserve/favicon.svg") {
		const abs = path.join(ctx.client.dir, "favicon.svg");
		const stat = await fsp.stat(abs).catch(() => null);
		if (!stat?.isFile()) {
			notFound(res);
			return;
		}
		sendFile(
			req,
			res,
			{ abs, size: stat.size, mtimeMs: stat.mtimeMs, contentType: "image/svg+xml" },
			"public, max-age=86400",
		);
		return;
	}

	// The adapter owns method checks, content-type checks, and body-size limits
	// (via maxBodySize) that the old hand-rolled /__mdxserve/api/* routes used to
	// do themselves.
	if (pathname.startsWith("/__mdxserve/trpc/")) {
		await nodeHTTPRequestHandler({
			req,
			res,
			router: appRouter,
			path: pathname.slice("/__mdxserve/trpc/".length),
			// Sized for saveDocNode's 256 KB markdown cap with headroom; the
			// other mutations' inputs are bounded far below this by their schemas.
			maxBodySize: 320 * 1024,
			createContext: () => ({
				rootInfos,
				diagrams: ctx.diagrams,
				roots: ctx.roots,
				registry,
				isLoopback,
				permissions: ctx.permissions,
				docCache,
				search: searchService,
				docs,
				origin: req.headers.origin,
				host: req.headers.host,
			}),
			onError: ({ error }) => {
				if (error.code === "INTERNAL_SERVER_ERROR") console.error(error);
			},
		});
		return;
	}

	if (pathname === GET_ASSET_PATH) {
		await handleGetAsset(req, res, new URLSearchParams(search), {
			roots: rootInfos,
			publicOnly: restricted,
		});
		return;
	}

	// The built client: content-hashed, so cached for a year.
	if (pathname.startsWith(CLIENT_ASSETS_PREFIX)) {
		await sendClientAsset(req, res, ctx.client.dir, pathname.slice(CLIENT_ASSETS_PREFIX.length));
		return;
	}

	// Nothing else lives under the server's own prefix.
	if (pathname.startsWith(MDXSERVE_PREFIX)) {
		notFound(res);
		return;
	}

	if (pathname === "/") {
		if (roots.length === 1) {
			res.statusCode = 302;
			res.setHeader("Location", encodeURI(`${roots[0]}/`));
			res.end();
			return;
		}
		const route: Route = { kind: "home", roots: rootInfos };
		res.statusCode = 200;
		res.setHeader("Content-Type", "text/html; charset=utf-8");
		res.end(shell(route));
		return;
	}

	const decodedPathname = decodeURIComponent(pathname);
	const hit = resolveRoot(roots, decodedPathname);

	if (hit === null) {
		if (wantsHtml(req)) {
			const route: Route = { kind: "notfound", path: decodedPathname };
			res.statusCode = 404;
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.end(shell(route));
			return;
		}
		res.statusCode = 404;
		res.end("Not found");
		return;
	}

	const { root, abs } = hit;
	if (restricted && !isPublicPath(root, abs)) {
		res.statusCode = 404;
		res.end("Not found");
		return;
	}
	const rootInfo = rootInfoFor(rootInfos, root);

	let stat: fs.Stats | null = null;
	try {
		stat = await fsp.stat(abs);
	} catch {
		stat = null;
	}

	if (stat?.isDirectory()) {
		if (!pathname.endsWith("/")) {
			res.statusCode = 301;
			res.setHeader("Location", `${pathname}/${search}`);
			res.end();
			return;
		}
		// The listing itself comes from ListingService, the same way
		// getFolderListing gets it — the stat above only decides which
		// representation to serve, and the service still has the final say on
		// whether this directory may be listed at all.
		const result = await new ListingService(rootInfos, docCache, restricted).folderListing(
			decodedPathname,
		);
		if (result.kind === "ok") {
			const route: Route = { kind: "listing", ...result.listing };
			res.statusCode = 200;
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.end(shell(route));
			return;
		}
		const route: Route = {
			kind: "notfound",
			path: decodedPathname,
			rootName: rootInfo.name,
			rootDir: rootInfo.dir,
		};
		res.statusCode = 404;
		res.setHeader("Content-Type", "text/html; charset=utf-8");
		res.end(shell(route));
		return;
	}

	if (stat?.isFile() && isDocFile(abs)) {
		if (wantsHtml(req)) {
			const metadataResult = await docs.readMetadata(abs, restricted);
			const metadata = metadataResult.kind === "ok" ? metadataResult.metadata : undefined;
			const route: Route = {
				kind: "doc",
				path: abs,
				rootName: rootInfo.name,
				rootDir: rootInfo.dir,
				mtime: stat.mtimeMs,
			};
			res.statusCode = 200;
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.end(shell(route, metadata));
			return;
		}

		// A non-HTML request for a document has nothing to serve: clients read
		// documents as JSON from getDocument.
		res.statusCode = 404;
		res.end("Not found");
		return;
	}

	if (stat === null) {
		if (wantsHtml(req)) {
			const route: Route = {
				kind: "notfound",
				path: decodedPathname,
				rootName: rootInfo.name,
				rootDir: rootInfo.dir,
			};
			res.statusCode = 404;
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.end(shell(route));
			return;
		}
	} else if (stat.isFile()) {
		// Any other file in a root (an image, a PDF a document links to) is served
		// with the rules getAsset applies.
		await serveRootFile(req, res, abs, { roots: rootInfos, publicOnly: restricted });
		return;
	}

	notFound(res);
}
