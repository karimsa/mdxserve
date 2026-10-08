import http from "node:http";
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import { allowFsDir, createDevServer, disallowFsDir } from "../rendering/vite.js";
import { renderAppCss } from "../rendering/app-css.js";
import { getPackageRoot, resolveFromPkg } from "../infra/pkg.js";
import { getViteCacheDir } from "../infra/cache.js";
import { resolveRoot } from "../roots/paths.js";
import { isServable } from "../roots/servable.js";
import { describeDocChange, type DocChange } from "./doc-change.js";
import { loadRegistry } from "../components/registry.js";
import type { RootInfo } from "../roots/root-info.js";
import { RootsService } from "../roots/service.js";
import { ServerRegistry, mdxserveHome } from "../servers/server-registry.js";
import { admitBindHost, loopbackBindHost } from "../servers/bind-host.js";
import { serverBaseUrl } from "../servers/remote.js";
import { ServerLock } from "../servers/server-lock.js";
import { RenderService } from "../rendering/render.js";
import { bundleStandalone } from "../rendering/bundle.js";
import type { BundlePort } from "../rendering/protocol.js";
import { DocCache } from "../docs/doc-cache.js";
import { SearchService } from "../search/service.js";
import { DocsService } from "../docs/service.js";
import { handleRequest } from "./server.js";

export interface StartServerOptions {
	roots: string[];
	port: number;
	host: string;
	dangerousAllowNetwork?: boolean;
}

/** Regenerate `file` for the given `roots`, so a root added/removed at runtime shows up in HMR's Tailwind scan. */
async function writeAppCss(file: string, roots: string[], pkgRoot: string): Promise<void> {
	await fsp.writeFile(
		file,
		renderAppCss({
			sourceDirs: roots,
			tailwindCss: resolveFromPkg("tailwindcss/index.css"),
			clientDir: path.join(pkgRoot, "client"),
		}),
		"utf8",
	);
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

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::"]);

/** The LAN address to advertise for `host`, or undefined when only loopback is reachable. */
function networkAddress(host: string): string | undefined {
	if (loopbackBindHost(host) !== undefined) return undefined;
	// A wildcard bind is reachable on every interface; pick the first. A
	// concrete address is reachable only on itself.
	return WILDCARD_HOSTS.has(host) ? getLocalIPs()[0] : host;
}

export function printBanner(
	port: number,
	host: string,
	fallbackUsed: boolean,
	rootInfos: RootInfo[],
): void {
	const localUrl = serverBaseUrl({ host, port });
	const ip = networkAddress(host);
	const networkUrl = ip ? serverBaseUrl({ host: ip, port }) : undefined;

	const lines = ["mdxserve", "", `- Local:    ${localUrl}`];
	if (networkUrl) lines.push(`- Network:  ${networkUrl}`);
	lines.push(`- API:      ${localUrl}/__mdxserve/trpc`);
	lines.push("");
	if (rootInfos.length === 0) {
		lines.push("- (no roots mounted; run `mdxserve roots add <dir>`)");
	} else {
		for (const rootInfo of rootInfos) {
			lines.push(`- ${rootInfo.name}: ${localUrl}${rootInfo.dir}/`);
		}
	}
	if (fallbackUsed) lines.push("", "(port was in use; fell back to a free port)");

	const width = Math.max(...lines.map((line) => line.length)) + 2;
	const border = "─".repeat(width);
	console.log(`\n  ┌${border}┐`);
	for (const line of lines) {
		console.log(`  │ ${line.padEnd(width - 1)}│`);
	}
	console.log(`  └${border}┘\n`);
}

function listenWithFallback(server: http.Server, port: number, host: string): Promise<number> {
	return new Promise((resolve, reject) => {
		function tryListen(candidatePort: number): void {
			const onError = (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE" && candidatePort !== 0) {
					server.removeListener("error", onError);
					tryListen(0);
					return;
				}
				server.removeListener("error", onError);
				reject(err);
			};
			server.once("error", onError);
			server.listen(candidatePort, host, () => {
				server.removeListener("error", onError);
				const address = server.address();
				resolve(address && typeof address === "object" ? address.port : candidatePort);
			});
		}
		tryListen(port);
	});
}

export type StartOutcome =
	| { kind: "ok" }
	/** Another `mdxserve serve` holds the lock; `port`/`host` are unknown while it is still starting up. */
	| { kind: "already-running"; pid: number; port?: number; host?: string }
	| { kind: "error"; message: string };

export async function startServer(options: StartServerOptions): Promise<StartOutcome> {
	const { roots } = options;
	const bind = admitBindHost(options.host, options.dangerousAllowNetwork);
	if (bind.kind !== "ok") return bind;
	const { host } = bind;

	// One server per user: take the lock before anything expensive (and before
	// loadRegistry, so this path is testable without a build). A held lock is
	// the normal "you already have one running" case, not a failure of ours.
	const lock = new ServerLock();
	const serverRegistry = new ServerRegistry();
	const acquired = lock.acquire();
	if (acquired.kind === "held") {
		const running = serverRegistry.current();
		return { kind: "already-running", pid: acquired.pid, port: running?.port, host: running?.host };
	}
	if (acquired.kind === "error") return { kind: "error", message: acquired.message };

	const pkgRoot = getPackageRoot();

	// Per-process state: the one mutable set of directories this server
	// serves. Restore the configured roots and persist explicit startup additions;
	// root procedures and external config edits share the same change listeners.
	const rootsService = new RootsService(
		process.cwd(),
		os.homedir(),
		[],
		path.join(mdxserveHome(), "config.json"),
	);
	const initialized = await rootsService.initialize(roots);
	if (initialized.kind !== "ok") {
		lock.release();
		return { kind: "error", message: initialized.message };
	}

	// Let a missing dist/registry.json (i.e. "run yarn build" first) propagate
	// and fail startup fast, rather than only failing the first CLI call.
	const registry = loadRegistry();

	const cssDir = await fsp.mkdtemp(path.join(os.tmpdir(), "mdxserve-"));
	const cssFile = path.join(cssDir, "app.css");
	await writeAppCss(
		cssFile,
		rootsService.list().map((info) => info.dir),
		pkgRoot,
	);

	const httpServer = http.createServer();
	const vite = await createDevServer({
		roots: rootsService.list().map((info) => info.dir),
		viteRoot: cssDir,
		cacheDir: getViteCacheDir(),
		httpServer,
		extraFsAllow: [cssDir],
	});

	// Vite's own root is the generated CSS temp dir, not any served root, so
	// none of them are watched by default — every root needs adding explicitly.
	// Chokidar applies the configured `ignored` globs to added paths too.
	for (const rootInfo of rootsService.list()) vite.watcher.add(rootInfo.dir);

	const renderer = new RenderService(vite);

	// One rolldown build at a time: exportDoc is CPU-heavy and two tabs (or a
	// double-click) must queue rather than run concurrent builds.
	let exportChain: Promise<unknown> = Promise.resolve();
	const bundle: BundlePort = (input) => {
		const next = exportChain.then(() => bundleStandalone(input));
		exportChain = next.catch(() => undefined);
		return next;
	};

	const docCache = new DocCache();
	const search = new SearchService(docCache);
	const docs = new DocsService(rootsService, registry);

	httpServer.on("request", (req, res) => {
		handleRequest(req, res, {
			roots: rootsService,
			registry,
			pkgRoot,
			vite,
			cssFile,
			render: (absPath) => renderer.render(absPath),
			bundle,
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

	function onWatchEvent(changedPath: string): void {
		if (!isServable(path.basename(changedPath))) return;
		const liveRoots = rootsService.list().map((info) => info.dir);
		const hit = resolveRoot(liveRoots, path.dirname(changedPath));
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

	// Tell the viewer which doc was edited. Vite's own HMR payload can't: a
	// doc module has no HMR boundary of its own, so its update is attributed
	// to whichever importer accepted it (App.tsx), and the Tailwind rebuild
	// the edit triggers arrives as a separate app.css update. Debounced the
	// same way, keyed by path so an editor's double-write is one event.
	const changedDocs = new Map<string, DocChange>();
	let docFlushTimer: NodeJS.Timeout | null = null;

	function onDocChange(changedPath: string): void {
		const change = describeDocChange(rootsService.list(), changedPath);
		if (!change) return;
		changedDocs.set(change.path, change);
		if (docFlushTimer) return;
		docFlushTimer = setTimeout(() => {
			docFlushTimer = null;
			const files = [...changedDocs.values()];
			changedDocs.clear();
			vite.ws.send({ type: "custom", event: "mdxserve:doc-changed", data: { files } });
		}, 100);
	}

	vite.watcher.on("change", onDocChange);

	// Apply a live root change to the running Vite server: its fs.allow list,
	// its watcher, and the generated app.css (Tailwind's @source scan) all
	// need to move in lockstep with the mounted set, or a newly-added root's
	// docs would 403 out of Vite even though RootsService already serves them.
	// By the time this runs the set has already changed, so nothing in here may
	// reject: a failure would surface as an error on a mutation that did
	// succeed, and a retry would then read as "already mounted". Each step is
	// best-effort and logged; the registry write and the ws broadcast are
	// independent of the Vite steps and of each other.
	rootsService.onChange(async ({ added, removed, roots: mountedRoots }) => {
		const dirs = mountedRoots.map((info) => info.dir);
		try {
			for (const dir of removed) {
				vite.watcher.unwatch(dir);
				disallowFsDir(vite, dir);
			}
			for (const dir of added) {
				allowFsDir(vite, dir);
				vite.watcher.add(dir);
			}
			await writeAppCss(cssFile, dirs, pkgRoot);
		} catch (error) {
			console.error(error);
		}
		serverRegistry.updateRoots(process.pid, dirs);
		try {
			vite.ws.send({
				type: "custom",
				event: "mdxserve:roots-changed",
				data: { added, removed, roots: mountedRoots },
			});
		} catch (error) {
			console.error(error);
		}
	});

	const stopConfigWatch = rootsService.watchConfig((message) =>
		console.error(`mdxserve: ${message}`),
	);

	const actualPort = await listenWithFallback(httpServer, options.port, host);
	printBanner(actualPort, host, actualPort !== options.port, rootsService.list());
	serverRegistry.register({
		port: actualPort,
		pid: process.pid,
		host,
		roots: rootsService.list().map((info) => info.dir),
	});

	// Both are idempotent and synchronous, so they are safe to repeat from the
	// `exit` handler — the only hook that still runs after an uncaught throw.
	function releaseInstance(): void {
		stopConfigWatch();
		serverRegistry.unregister(process.pid);
		lock.release();
	}
	process.on("exit", releaseInstance);

	let shuttingDown = false;
	async function shutdown(): Promise<void> {
		if (shuttingDown) return;
		shuttingDown = true;
		console.log("\n  Shutting down…");
		try {
			stopConfigWatch();
			if (flushTimer) clearTimeout(flushTimer);
			await vite.close();
		} finally {
			// The lock and registry row stay ours until the listener has actually
			// let go of the port: a process manager restarting mdxserve during
			// teardown must find the lock still held (and wait/retry) rather than
			// acquire it, hit EADDRINUSE on the configured port, and silently fall
			// back to a random one. The `exit` handler above covers the 1s timeout.
			httpServer.close(() => {
				releaseInstance();
				process.exit(0);
			});
			setTimeout(() => process.exit(0), 1000).unref();
		}
	}

	process.on("SIGINT", () => {
		void shutdown();
	});
	process.on("SIGTERM", () => {
		void shutdown();
	});

	return { kind: "ok" };
}
