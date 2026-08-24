import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import type { ViteDevServer } from "vite";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { nodeHTTPRequestHandler } from "@trpc/server/adapters/node-http";
import { createDevServer } from "./vite.js";
import { getPackageRoot } from "./pkg.js";
import { getViteCacheDir } from "./cache.js";
import { readListing, isServable } from "./listing.js";
import { renderShell, type Route, type RootInfo } from "./shell.js";
import { resolveRoot } from "./paths.js";
import { loadRegistry } from "./registry.js";
import { createMcpServer, type McpContext } from "./mcp.js";
import { computeRootInfos, rootInfoFor } from "./roots.js";
import { registerServer, unregisterServer } from "./server-registry.js";
import { renderDocument } from "./render.js";
import { appRouter } from "./api/router.js";

export interface StartServerOptions {
	roots: string[];
	port: number;
	host: string;
}

const MDXSERVE_PREFIX = "/__mdxserve/";

function isDocFile(p: string): boolean {
	const ext = path.extname(p).toLowerCase();
	return ext === ".md" || ext === ".mdx";
}

// Browser navigations (typed URL, clicked link, redirect) send an Accept
// header that prefers text/html. The client entry's `import(file)` for the
// same .md/.mdx path is a module fetch, not a navigation, and does not — so
// this is how we tell "render the page shell" apart from "compile this file
// as a module" for the exact same URL.
function wantsHtml(req: http.IncomingMessage): boolean {
	const accept = req.headers.accept ?? "";
	return accept.includes("text/html");
}

function toPosix(p: string): string {
	return p.split(path.sep).join("/");
}

async function generateAppCss(
	roots: string[],
	pkgRoot: string,
): Promise<{ dir: string; file: string }> {
	const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "mdxserve-"));

	// Tailwind v4's @import/@plugin resolution walks up from the CSS file's
	// own directory, which won't reach mdxserve's node_modules from a temp
	// dir — so point directly at the package's own copies.
	const tailwindImport = path.join(pkgRoot, "node_modules", "tailwindcss", "index.css");
	const designCssPath = path.join(pkgRoot, "client", "app.css");

	const rootSources = roots
		.map(
			(root) => `@source "${toPosix(root)}/**/*.{md,mdx,js,jsx,ts,tsx}";
@source not "${toPosix(root)}/**/.{git,mdxserve,venv,cache}/**";
@source not "${toPosix(root)}/**/{node_modules,venv,dist,build,target,__pycache__}/**";`,
		)
		.join("\n");

	// @import (rather than inlining) the package's own app.css so edits to it
	// are tracked as a real CSS dependency and hot-reload without a restart.
	const css = `@import "${toPosix(tailwindImport)}";
@import "${toPosix(designCssPath)}";
${rootSources}
@source "${toPosix(path.join(pkgRoot, "client"))}";
@source "${toPosix(path.join(pkgRoot, "src"))}";
`;

	const file = path.join(tmpDir, "app.css");
	await fsp.writeFile(file, css, "utf8");
	return { dir: tmpDir, file };
}

function getLocalIPs(): string[] {
	const nets = os.networkInterfaces();
	const addresses: string[] = [];
	for (const name of Object.keys(nets)) {
		for (const net of nets[name] ?? []) {
			if (net.family === "IPv4" && !net.internal) {
				addresses.push(net.address);
			}
		}
	}
	return addresses;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const WILDCARD_HOSTS = new Set(["0.0.0.0", "::"]);

/** The LAN address to advertise for `host`, or undefined when only loopback is reachable. */
function networkAddress(host: string): string | undefined {
	if (LOOPBACK_HOSTS.has(host)) return undefined;
	// A wildcard bind is reachable on every interface; pick the first. A
	// concrete address is reachable only on itself.
	return WILDCARD_HOSTS.has(host) ? getLocalIPs()[0] : host;
}

function printBanner(
	port: number,
	host: string,
	fallbackUsed: boolean,
	rootInfos: RootInfo[],
): void {
	const localUrl = `http://localhost:${port}`;
	const ip = networkAddress(host);
	const networkUrl = ip ? `http://${ip}:${port}` : undefined;

	const lines = ["mdxserve", "", `- Local:    ${localUrl}`];
	if (networkUrl) lines.push(`- Network:  ${networkUrl}`);
	lines.push(`- MCP:      ${localUrl}/__mdxserve/mcp`);
	lines.push(`- API:      ${localUrl}/__mdxserve/trpc`);
	lines.push("");
	for (const r of rootInfos) lines.push(`- ${r.name}: ${localUrl}${r.dir}/`);
	if (fallbackUsed) lines.push("", "(port was in use; fell back to a free port)");

	const width = Math.max(...lines.map((l) => l.length)) + 2;
	const border = "─".repeat(width);
	console.log(`\n  ┌${border}┐`);
	for (const line of lines) {
		console.log(`  │ ${line.padEnd(width - 1)}│`);
	}
	console.log(`  └${border}┘\n`);
}

function listenWithFallback(server: http.Server, port: number, host: string): Promise<number> {
	return new Promise((resolve, reject) => {
		function tryListen(p: number): void {
			const onError = (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE" && p !== 0) {
					server.removeListener("error", onError);
					tryListen(0);
					return;
				}
				server.removeListener("error", onError);
				reject(err);
			};
			server.once("error", onError);
			server.listen(p, host, () => {
				server.removeListener("error", onError);
				const address = server.address();
				resolve(address && typeof address === "object" ? address.port : p);
			});
		}
		tryListen(port);
	});
}

export interface RequestContext {
	roots: string[];
	rootInfos: RootInfo[];
	pkgRoot: string;
	vite: ViteDevServer;
	cssFile: string;
	mcp: McpContext;
}

export async function handleRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	ctx: RequestContext,
): Promise<void> {
	const { roots, rootInfos, pkgRoot, vite } = ctx;
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
		const mcpServer = createMcpServer(isLoopback ? ctx.mcp : { ...ctx.mcp, render: undefined });
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
				roots,
				rootInfos,
				registry: ctx.mcp.registry,
				isLoopback,
				render: ctx.mcp.render,
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
		const route = readListing(abs, rootInfo);
		res.statusCode = 200;
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

export async function startServer(options: StartServerOptions): Promise<void> {
	const { roots, host } = options;
	const pkgRoot = getPackageRoot();
	const rootInfos = computeRootInfos(roots);

	// Let a missing dist/registry.json (i.e. "run yarn build" first) propagate
	// and fail startup fast, rather than only failing the first MCP call.
	const registry = loadRegistry();

	const { dir: cssDir, file: cssFile } = await generateAppCss(roots, pkgRoot);

	const httpServer = http.createServer();
	const vite = await createDevServer({
		roots,
		viteRoot: cssDir,
		cacheDir: getViteCacheDir(roots[0]),
		httpServer,
		extraFsAllow: [cssDir],
	});

	// Vite's own root is the generated CSS temp dir, not any served root, so
	// none of them are watched by default — every root needs adding explicitly.
	// Chokidar applies the configured `ignored` globs to added paths too.
	for (const r of roots) vite.watcher.add(r);

	httpServer.on("request", (req, res) => {
		handleRequest(req, res, {
			roots,
			rootInfos,
			pkgRoot,
			vite,
			cssFile,
			mcp: { getRoots: () => rootInfos, registry, render: (p) => renderDocument(vite, p) },
		}).catch((error) => {
			console.error(error);
			if (!res.headersSent) {
				res.statusCode = 500;
				res.end("Internal Server Error");
			}
		});
	});

	// Auto-refresh open listings: chokidar already watches every root for
	// Vite's own HMR, so ride the same watcher instead of standing up a second
	// one. Debounce so a bulk op (git checkout, rm -rf dir) fires one event
	// instead of a storm.
	const changedDirs = new Set<string>();
	let flushTimer: NodeJS.Timeout | null = null;

	function onWatchEvent(p: string): void {
		if (!isServable(path.basename(p))) return;
		const hit = resolveRoot(roots, path.dirname(p));
		if (!hit) return;

		changedDirs.add(hit.abs.endsWith("/") ? hit.abs : `${hit.abs}/`);
		if (flushTimer) return;
		flushTimer = setTimeout(() => {
			flushTimer = null;
			const dirs = [...changedDirs];
			changedDirs.clear();
			vite.ws.send({ type: "custom", event: "mdxserve:listing-changed", data: { dirs } });
		}, 100);
	}

	vite.watcher.on("add", onWatchEvent);
	vite.watcher.on("unlink", onWatchEvent);
	vite.watcher.on("addDir", onWatchEvent);
	vite.watcher.on("unlinkDir", onWatchEvent);

	const actualPort = await listenWithFallback(httpServer, options.port, host);
	printBanner(actualPort, host, actualPort !== options.port, rootInfos);
	registerServer({ port: actualPort, pid: process.pid, host, roots });

	let shuttingDown = false;
	async function shutdown(): Promise<void> {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log("\n  Shutting down…");
		unregisterServer(actualPort);
		try {
			if (flushTimer) clearTimeout(flushTimer);
			await vite.close();
		} finally {
			httpServer.close(() => process.exit(0));
			setTimeout(() => process.exit(0), 1000).unref();
		}
	}

	process.on("SIGINT", () => {
		void shutdown();
	});
	process.on("SIGTERM", () => {
		void shutdown();
	});
}
