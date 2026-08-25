import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import type { ViteDevServer } from "vite";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import { ListingService } from "../listing/service.js";
import { renderShell, type Route } from "./shell.js";
import type { RootInfo } from "../roots/root-info.js";
import { resolveRoot } from "../roots/paths.js";
import { isDocFile } from "../roots/servable.js";
import type { Registry } from "../components/registry.js";
import { createMcpServer } from "../mcp/server.js";
import { rootInfoFor } from "../roots/root-info.js";
import type { RenderPort } from "../rendering/protocol.js";
import type { DocCache } from "../docs/doc-cache.js";
import type { SearchService } from "../search/service.js";
import type { DocsService } from "../docs/service.js";
import { appRouter } from "../api/router.js";

const MDXSERVE_PREFIX = "/__mdxserve/";

// Browser navigations (typed URL, clicked link, redirect) send an Accept
// header that prefers text/html. The client entry's `import(file)` for the
// same .md/.mdx path is a module fetch, not a navigation, and does not — so
// this is how we tell "render the page shell" apart from "compile this file
// as a module" for the exact same URL.
function wantsHtml(req: http.IncomingMessage): boolean {
	const accept = req.headers.accept ?? "";
	return accept.includes("text/html");
}

/** Exported for `src/http/start.ts`'s generated Tailwind entry CSS, which needs the same rewrite. */
export function toPosix(filePath: string): string {
	return filePath.split(path.sep).join("/");
}

export interface RequestContext {
	rootInfos: RootInfo[];
	registry: Registry;
	pkgRoot: string;
	vite: ViteDevServer;
	cssFile: string;
	/** Renders a doc server-side; only defined when a Vite dev server is live. */
	render?: RenderPort;
	/** Per-process state, created once in startServer. */
	docCache: DocCache;
	search: SearchService;
	/** Per-process state, created once in startServer: it owns the per-file save lock. */
	docs: DocsService;
}

export async function handleRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	ctx: RequestContext,
): Promise<void> {
	const { rootInfos, registry, pkgRoot, vite, docCache, search: searchService, docs, render } = ctx;
	const roots = rootInfos.map((rootInfo) => rootInfo.dir);
	// Reference the entry by its real /@fs/ path so Vite's HTML pre-transform
	// can resolve it (the /__mdxserve/ alias only exists in our router).
	const entrySrc = `/@fs/${toPosix(path.join(pkgRoot, "client", "entry.tsx"))}`;
	const url = req.url ?? "/";
	const pathname = url.split("?")[0] ?? "/";
	const search = url.slice(pathname.length);

	// The validate_doc render step executes a served doc's top-level JS in a
	// Node worker. Serving pages to the LAN (--host 0.0.0.0) is deliberate
	// sharing, but remote peers shouldn't be able to run served files with
	// Node's privileges — so rendering (via /__mdxserve/mcp and
	// /__mdxserve/trpc) is reserved for same-machine callers;
	// everyone else gets the static-only validation (`rendered: false`).
	// "Same machine" is loopback, or a connection whose remote address is
	// this socket's own local address: the stdio bridge connects to the
	// host a server registered (e.g. --host 192.168.1.10), which arrives
	// with the LAN address on both ends — something no other machine's
	// packet can present.
	const remoteAddress = req.socket.remoteAddress;
	const isLoopback =
		remoteAddress === "127.0.0.1" ||
		remoteAddress === "::1" ||
		remoteAddress === "::ffff:127.0.0.1" ||
		(remoteAddress !== undefined && remoteAddress === req.socket.localAddress);

	if (pathname === "/favicon.ico" || pathname === "/__mdxserve/favicon.svg") {
		res.statusCode = 200;
		res.setHeader("Content-Type", "image/svg+xml");
		res.setHeader("Cache-Control", "public, max-age=86400");
		res.end(await fsp.readFile(path.join(pkgRoot, "client", "favicon.svg")));
		return;
	}

	// Must be checked before the generic /__mdxserve/* -> /@fs/ rewrite below,
	// since this path also starts with MDXSERVE_PREFIX.
	if (pathname === "/__mdxserve/mcp") {
		if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
			res.statusCode = 405;
			res.setHeader("Allow", "GET, POST, DELETE");
			res.end();
			return;
		}
		// Stateless: a fresh transport+server per request; the SDK answers
		// GET/DELETE itself in this mode. DNS-rebinding protection is left off,
		// matching the posture of the /__mdxserve/trpc/* routes below (loopback
		// by default, and these tools are read-only).
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		// isLoopback is computed above; a LAN caller (--host 0.0.0.0) still gets
		// every tool, just without the render step — see the comment above.
		const mcpServer = createMcpServer({
			getRoots: () => rootInfos,
			registry,
			render,
			docCache,
			search: searchService,
			allowRender: isLoopback,
		});
		res.on("close", () => {
			void transport.close();
			void mcpServer.close();
		});
		await mcpServer.connect(transport);
		await transport.handleRequest(req, res); // SDK reads the body itself
		return;
	}

	// Must be checked before the generic /__mdxserve/* -> /@fs/ rewrite below,
	// since these paths also start with MDXSERVE_PREFIX. The adapter owns
	// method checks, content-type checks, and body-size limits (via
	// maxBodySize) that the old hand-rolled /__mdxserve/api/* routes used to
	// do themselves.
	if (pathname.startsWith("/__mdxserve/trpc/")) {
		await nodeHTTPRequestHandler({
			req,
			res,
			router: appRouter,
			path: pathname.slice("/__mdxserve/trpc/".length),
			// Sized for saveDocSection's 256 KB markdown cap with headroom; the
			// other mutations' inputs are bounded far below this by their schemas.
			maxBodySize: 320 * 1024,
			createContext: () => ({
				rootInfos,
				registry,
				isLoopback,
				render,
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

	if (pathname.startsWith(MDXSERVE_PREFIX)) {
		const rest = pathname.slice(MDXSERVE_PREFIX.length);
		const target = rest === "app.css" ? ctx.cssFile : path.join(pkgRoot, "client", rest);
		req.url = `/@fs/${toPosix(target)}${search}`;
		vite.middlewares(req, res, () => {
			res.statusCode = 404;
			res.end("Not found");
		});
		return;
	}

	// The client re-fetches a doc module as /@fs/<abs>.md?t=… after an HMR
	// edit. Vite's own transform middleware doesn't recognize .md/.mdx as
	// JS-like, so route it through transformRequest() directly, same as the
	// doc branch below. Every other /@fs/ request (client entry, client/
	// assets, .tsx component imports, optimized deps) passes straight through
	// to vite.middlewares, gated by fs.allow.
	if (pathname.startsWith("/@fs/")) {
		const rest = pathname.slice("/@fs/".length);
		const abs = `/${decodeURIComponent(rest)}`;
		const hit = resolveRoot(roots, abs);

		if (hit && isDocFile(hit.abs)) {
			try {
				const result = await vite.transformRequest(`/@fs${hit.abs}`);
				if (result) {
					res.statusCode = 200;
					res.setHeader("Content-Type", "text/javascript; charset=utf-8");
					res.end(result.code);
					return;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(error);
				res.statusCode = 200;
				res.setHeader("Content-Type", "text/javascript; charset=utf-8");
				res.end(`throw new Error(${JSON.stringify(`Failed to compile ${hit.abs}: ${message}`)});`);
				return;
			}
		}

		vite.middlewares(req, res, () => {
			res.statusCode = 404;
			res.end("Not found");
		});
		return;
	}

	// /@vite/client, /@react-refresh, /@id/… etc. — resolveRoot below would
	// 404 these; let Vite's own middleware handle them.
	if (pathname.startsWith("/@")) {
		vite.middlewares(req, res, () => {
			res.statusCode = 404;
			res.end("Not found");
		});
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
		res.end(await vite.transformIndexHtml(pathname, renderShell(route, entrySrc, roots.length)));
		return;
	}

	const decodedPathname = decodeURIComponent(pathname);
	const hit = resolveRoot(roots, decodedPathname);

	if (hit === null) {
		if (wantsHtml(req)) {
			const route: Route = { kind: "notfound", path: decodedPathname };
			res.statusCode = 404;
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.end(await vite.transformIndexHtml(pathname, renderShell(route, entrySrc, roots.length)));
			return;
		}
		res.statusCode = 404;
		res.end("Not found");
		return;
	}

	const { root, abs } = hit;
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
		const result = await new ListingService(rootInfos, docCache).folderListing(decodedPathname);
		if (result.kind === "ok") {
			const route: Route = { kind: "listing", ...result.listing };
			res.statusCode = 200;
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.end(await vite.transformIndexHtml(pathname, renderShell(route, entrySrc, roots.length)));
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
		res.end(await vite.transformIndexHtml(pathname, renderShell(route, entrySrc, roots.length)));
		return;
	}

	if (stat?.isFile() && isDocFile(abs)) {
		if (wantsHtml(req)) {
			const route: Route = {
				kind: "doc",
				path: abs,
				rootName: rootInfo.name,
				rootDir: rootInfo.dir,
				mtime: stat.mtimeMs,
			};
			res.statusCode = 200;
			res.setHeader("Content-Type", "text/html; charset=utf-8");
			res.end(await vite.transformIndexHtml(pathname, renderShell(route, entrySrc, roots.length)));
			return;
		}

		// The client entry does `import(file)` for this same URL to fetch the
		// compiled module. Use the decoded, resolved abs path (not the raw
		// pathname) so a doc whose path contains spaces compiles correctly.
		try {
			const result = await vite.transformRequest(`/@fs${abs}`);
			if (result) {
				res.statusCode = 200;
				res.setHeader("Content-Type", "text/javascript; charset=utf-8");
				res.end(result.code);
				return;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(error);
			res.statusCode = 200;
			res.setHeader("Content-Type", "text/javascript; charset=utf-8");
			res.end(`throw new Error(${JSON.stringify(`Failed to compile ${abs}: ${message}`)});`);
			return;
		}
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
			res.end(await vite.transformIndexHtml(pathname, renderShell(route, entrySrc, roots.length)));
			return;
		}
	} else if (stat.isFile()) {
		// Non-doc file inside a root (images, .txt, …): hand it to Vite as a
		// static asset via /@fs/, mirroring the /__mdxserve/ rewrite above. This
		// is what makes `![](./img.png)` work in a root that isn't Vite's own.
		req.url = `/@fs${pathname}${search}`;
		vite.middlewares(req, res, () => {
			res.statusCode = 404;
			res.end("Not found");
		});
		return;
	}

	vite.middlewares(req, res, () => {
		res.statusCode = 404;
		res.end("Not found");
	});
}
