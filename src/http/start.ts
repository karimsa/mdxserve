import http from "node:http";
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import { createDevServer } from "../rendering/vite.js";
import { getPackageRoot } from "../infra/pkg.js";
import { getViteCacheDir } from "../infra/cache.js";
import { resolveRoot } from "../roots/paths.js";
import { isServable } from "../roots/servable.js";
import { loadRegistry } from "../components/registry.js";
import { computeRootInfos } from "../roots/root-info.js";
import type { RootInfo } from "../roots/root-info.js";
import { ServerRegistry } from "../servers/server-registry.js";
import { RenderService } from "../rendering/render.js";
import { DocCache } from "../docs/doc-cache.js";
import { SearchService } from "../search/service.js";
import { DocsService } from "../docs/service.js";
import { handleRequest, toPosix } from "./server.js";

export interface StartServerOptions {
	roots: string[];
	port: number;
	host: string;
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

	const renderer = new RenderService(vite);
	const serverRegistry = new ServerRegistry();
	const docCache = new DocCache();
	const search = new SearchService(docCache);
	const docs = new DocsService(rootInfos, registry);

	httpServer.on("request", (req, res) => {
		handleRequest(req, res, {
			rootInfos,
			registry,
			pkgRoot,
			vite,
			cssFile,
			render: (absPath) => renderer.render(absPath),
			docCache,
			search,
			docs,
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
	serverRegistry.register({ port: actualPort, pid: process.pid, host, roots });

	let shuttingDown = false;
	async function shutdown(): Promise<void> {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log("\n  Shutting down…");
		serverRegistry.unregister(actualPort);
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
