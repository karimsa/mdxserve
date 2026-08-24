import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import trash from "trash";
import { z } from "zod";
import type { ViteDevServer } from "vite";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createDevServer } from "./vite.js";
import { getPackageRoot } from "./pkg.js";
import { getViteCacheDir } from "./cache.js";
import { readListing, readTree, isServable } from "./listing.js";
import { search as searchDocs } from "./search.js";
import { renderShell, type Route, type RootInfo } from "./shell.js";
import { resolveRoot, resolveDocPath, importResolves } from "./paths.js";
import { loadRegistry } from "./registry.js";
import { createMcpServer, type McpContext } from "./mcp.js";
import { computeRootInfos, rootNameOf } from "./roots.js";
import { registerServer, unregisterServer } from "./server-registry.js";
import { validateSource, type ValidationResult } from "./validate.js";
import { renderDocument } from "./render.js";

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

function rootInfoFor(rootInfos: RootInfo[], root: string): RootInfo {
	return rootInfos.find((r) => r.dir === root) ?? { name: rootNameOf(root), dir: root };
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

const MAX_DELETE_BODY = 64 * 1024;

const deleteBodySchema = z.object({
	paths: z.array(z.string().min(1)).min(1).max(500),
});

// A single path string, nothing more — no batching like /api/delete, since
// validation is a per-doc, agent-in-the-loop check.
const MAX_VALIDATE_BODY = 4 * 1024;

const validateBodySchema = z.object({
	path: z.string().min(1),
});

/** Read the full request body as UTF-8, or null if it exceeds `limit`. */
function readBody(req: http.IncomingMessage, limit: number): Promise<string | null> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		let overLimit = false;
		req.on("data", (chunk: Buffer) => {
			if (overLimit) return;
			size += chunk.length;
			if (size > limit) {
				// Resolve now but keep draining (discarding) the rest: destroying
				// the request would tear down the socket before the 413 response
				// reaches the client.
				overLimit = true;
				chunks.length = 0;
				resolve(null);
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (!overLimit) resolve(Buffer.concat(chunks).toString("utf8"));
		});
		req.on("error", reject);
	});
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

/**
 * The same static + render validation the `validate_doc` MCP tool runs,
 * shared with `POST /__mdxserve/api/validate` so the two paths can never
 * drift.
 */
async function validateDocAt(
	absPath: string,
	ctx: RequestContext,
	allowRender: boolean,
): Promise<ValidationResult> {
	const source = await fsp.readFile(absPath, "utf8");
	return validateSource({
		source,
		path: absPath,
		registry: ctx.mcp.registry,
		resolveImport: (specifier) => importResolves(absPath, specifier),
		render: allowRender ? ctx.mcp.render : undefined,
	});
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
	// /__mdxserve/api/validate) is reserved for same-machine callers;
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
		// matching the posture of the /__mdxserve/api/* routes below (loopback
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
	// since these paths also start with MDXSERVE_PREFIX.
	if (pathname.startsWith("/__mdxserve/api/")) {
		if (pathname === "/__mdxserve/api/listing") {
			const queryPath = new URLSearchParams(search).get("path") ?? "/";
			const hit = resolveRoot(roots, queryPath);

			let listingStat: fs.Stats | null = null;
			if (hit) {
				try {
					listingStat = await fsp.stat(hit.abs);
				} catch {
					listingStat = null;
				}
			}

			res.setHeader("Content-Type", "application/json; charset=utf-8");
			if (!hit || !listingStat?.isDirectory()) {
				res.statusCode = 404;
				res.end(JSON.stringify({ error: "Not found" }));
				return;
			}

			res.statusCode = 200;
			res.end(JSON.stringify(readListing(hit.abs, rootInfoFor(rootInfos, hit.root))));
			return;
		}

		if (pathname === "/__mdxserve/api/tree") {
			res.setHeader("Content-Type", "application/json; charset=utf-8");
			res.statusCode = 200;
			res.end(JSON.stringify({ roots: rootInfos.map((r) => ({ ...r, nodes: readTree(r.dir) })) }));
			return;
		}

		if (pathname === "/__mdxserve/api/search") {
			const q = new URLSearchParams(search).get("q") ?? "";
			res.setHeader("Content-Type", "application/json; charset=utf-8");
			res.statusCode = 200;
			res.end(JSON.stringify(searchDocs(rootInfos, q)));
			return;
		}

		// Deletes files only (not directories) and sends them to the OS Trash
		// (recoverable, unlike fs.rm). No response push here: the chokidar
		// watcher's existing `mdxserve:listing-changed` event already fires on
		// `unlink` and refreshes the client's tree/listing.
		if (pathname === "/__mdxserve/api/delete") {
			res.setHeader("Content-Type", "application/json; charset=utf-8");

			if (req.method !== "POST") {
				res.statusCode = 405;
				res.setHeader("Allow", "POST");
				res.end(JSON.stringify({ error: "Method not allowed" }));
				return;
			}

			// Compare the parsed media type, not a substring: a non-preflighted
			// cross-origin request can smuggle "application/json" into a
			// text/plain parameter (`text/plain;x=application/json`).
			const mediaType = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
			if (mediaType !== "application/json") {
				res.statusCode = 415;
				res.end(JSON.stringify({ error: "Expected application/json" }));
				return;
			}

			const body = await readBody(req, MAX_DELETE_BODY);
			if (body === null) {
				res.statusCode = 413;
				res.end(JSON.stringify({ error: "Body too large" }));
				return;
			}

			let paths: string[];
			try {
				paths = deleteBodySchema.parse(JSON.parse(body)).paths;
			} catch {
				res.statusCode = 400;
				res.end(JSON.stringify({ error: "Invalid body: expected { paths: string[] }" }));
				return;
			}

			const deleted: string[] = [];
			const failed: { path: string; error: string }[] = [];

			// resolveRoot is string-level only; a directory symlink inside a root
			// could point outside it. Re-check each file's real parent directory
			// against its real root before trashing anything. Cache per root since
			// a batch typically hits the same root many times.
			const realRoots = new Map<string, Promise<string>>();
			function realRoot(root: string): Promise<string> {
				let p = realRoots.get(root);
				if (!p) {
					p = fsp.realpath(root);
					realRoots.set(root, p);
				}
				return p;
			}

			// Serial so a failure attributes to its own path rather than racing
			// with the rest of the batch.
			for (const p of paths) {
				const hit = resolveRoot(roots, p);
				if (!hit || hit.abs === hit.root) {
					failed.push({ path: p, error: "Invalid path" });
					continue;
				}

				// Same servability rule as the listing: dotfiles, node_modules,
				// etc. are never surfaced in the UI, so they can't be deleted
				// through its API either. Checked on the root-relative segments,
				// not the whole absolute path — a root like ~/.config/... would
				// otherwise be undeletable.
				const rel = path.relative(hit.root, hit.abs);
				if (!rel.split("/").filter(Boolean).every(isServable)) {
					failed.push({ path: p, error: "Invalid path" });
					continue;
				}

				try {
					const realRootPath = await realRoot(hit.root);
					const realDir = await fsp.realpath(path.dirname(hit.abs));
					const relReal = path.relative(realRootPath, realDir);
					if (relReal.startsWith("..") || path.isAbsolute(relReal)) {
						failed.push({ path: p, error: "Invalid path" });
						continue;
					}
				} catch {
					failed.push({ path: p, error: "Not found" });
					continue;
				}

				let st: fs.Stats;
				try {
					st = await fsp.lstat(hit.abs);
				} catch {
					failed.push({ path: p, error: "Not found" });
					continue;
				}

				if (st.isDirectory()) {
					failed.push({ path: p, error: "Is a directory" });
					continue;
				}

				try {
					// glob: false — trash expands `*`/`[...]` metacharacters by default,
					// which would let a literal filename like "notes[1].md" match others.
					await trash(hit.abs, { glob: false });
					deleted.push(p);
				} catch (error) {
					failed.push({ path: p, error: error instanceof Error ? error.message : String(error) });
				}
			}

			res.statusCode = 200;
			res.end(JSON.stringify({ deleted, failed }));
			return;
		}

		// Same static + render validation as the validate_doc MCP tool, exposed
		// over HTTP so the stdio bridge (which has no Vite instance of its own)
		// can proxy to whichever live server actually owns the path instead of
		// falling back to a static-only check.
		if (pathname === "/__mdxserve/api/validate") {
			res.setHeader("Content-Type", "application/json; charset=utf-8");

			if (req.method !== "POST") {
				res.statusCode = 405;
				res.setHeader("Allow", "POST");
				res.end(JSON.stringify({ error: "Method not allowed" }));
				return;
			}

			// Compare the parsed media type, not a substring: a non-preflighted
			// cross-origin request can smuggle "application/json" into a
			// text/plain parameter (`text/plain;x=application/json`).
			const mediaType = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
			if (mediaType !== "application/json") {
				res.statusCode = 415;
				res.end(JSON.stringify({ error: "Expected application/json" }));
				return;
			}

			const body = await readBody(req, MAX_VALIDATE_BODY);
			if (body === null) {
				res.statusCode = 413;
				res.end(JSON.stringify({ error: "Body too large" }));
				return;
			}

			let docPath: string;
			try {
				docPath = validateBodySchema.parse(JSON.parse(body)).path;
			} catch {
				res.statusCode = 400;
				res.end(JSON.stringify({ error: "Invalid body: expected { path: string }" }));
				return;
			}

			const resolved = await resolveDocPath(roots, docPath);
			if (!resolved.ok) {
				res.statusCode = 404;
				res.end(JSON.stringify({ error: resolved.error }));
				return;
			}

			const result = await validateDocAt(resolved.abs, ctx, isLoopback);
			res.statusCode = 200;
			res.end(JSON.stringify(result));
			return;
		}

		res.setHeader("Content-Type", "application/json; charset=utf-8");
		res.statusCode = 404;
		res.end(JSON.stringify({ error: "Not found" }));
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
