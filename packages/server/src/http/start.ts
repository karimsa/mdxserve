import { DiagramsService } from "../diagrams/service.js";
import { PreferencesService } from "../preferences/service.js";
import { localAgentPort } from "../diagrams/adapters/agents.js";
import { normalizeDiagramImage } from "../diagrams/adapters/image.js";
import { validateDiagram } from "../diagrams/adapters/validate.js";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { watch } from "chokidar";
import { getPackageRoot } from "../infra/pkg.js";
import { isWatchIgnored, signalFileChanges } from "./watch-signals.js";
import { handleWatchErrors } from "./watch-errors.js";
import { loadShellTemplate } from "./shell.js";
import { realtimePeerCheck } from "./host.js";
import { announceTailscale, serverTailnetHosts } from "../tailscale/startup.js";
import { attachRealtime } from "../realtime/server.js";
import { loadRegistry } from "../components/registry.js";
import type { RootInfo } from "../roots/root-info.js";
import { RootsService } from "../roots/service.js";
import { ServerRegistry, mdxserveHome } from "../servers/server-registry.js";
import {
	resolveBindPermissions,
	loopbackBindHost,
	type PermissionMode,
} from "../servers/bind-host.js";
import { serverBaseUrl } from "../servers/remote.js";
import { ServerLock } from "../servers/server-lock.js";
import { DocCache } from "../docs/doc-cache.js";
import { SearchService } from "../search/service.js";
import { DocsService } from "../docs/service.js";
import { DocumentService } from "../document/service.js";
import { assetUrl } from "../assets/url.js";
import { handleRequest } from "./server.js";

export interface StartServerOptions {
	roots: string[];
	port: number;
	host: string;
	dangerousAllowNetwork?: boolean;
	permissions?: string;
	/** False (`--no-tailscale`) skips Tailscale detection, the tailnet hosts and their output. */
	tailscale?: boolean;
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

/** @internal Exported for its tests. */
export function printBanner(
	port: number,
	host: string,
	fallbackUsed: boolean,
	rootInfos: RootInfo[],
	permissions: PermissionMode = "full",
): void {
	const localUrl = serverBaseUrl({ host, port });
	const ip = networkAddress(host);
	const networkUrl = ip ? serverBaseUrl({ host: ip, port }) : undefined;

	const lines = ["mdxserve", "", `- Local:    ${localUrl}`];
	if (networkUrl) lines.push(`- Network:  ${networkUrl}`);
	lines.push(`- Permissions: ${permissions}`);
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
	const bind = resolveBindPermissions(
		options.host,
		options.permissions,
		options.dangerousAllowNetwork,
	);
	if (bind.kind !== "ok") return bind;
	const { host, permissions } = bind;
	const restricted = permissions === "restricted";
	if (restricted && roots.length !== 1) {
		return {
			kind: "error",
			message: "restricted permissions require exactly one explicit -w directory",
		};
	}

	// One server per user: take the lock before anything expensive (and before
	// loadRegistry, so this path is testable without a build). A held lock is
	// the normal "you already have one running" case, not a failure of ours.
	const lock = new ServerLock();
	const serverRegistry = new ServerRegistry();
	const acquired = lock.acquire();
	if (acquired.kind === "held") {
		if (restricted) {
			return {
				kind: "error",
				message:
					"restricted permissions cannot reuse an existing mdxserve server; use a separate MDXSERVE_HOME",
			};
		}
		const running = serverRegistry.current();
		return { kind: "already-running", pid: acquired.pid, port: running?.port, host: running?.host };
	}
	if (acquired.kind === "error") return { kind: "error", message: acquired.message };

	// Per-process state: the one mutable set of directories this server
	// serves. Restore the configured roots and persist explicit startup additions;
	// root procedures and external config edits share the same change listeners.
	const rootsService = new RootsService(
		process.cwd(),
		os.homedir(),
		[],
		restricted ? undefined : path.join(mdxserveHome(), "config.json"),
	);
	const initialized = await rootsService.initialize(roots);
	if (initialized.kind !== "ok") {
		lock.release();
		return { kind: "error", message: initialized.message };
	}

	// Let a missing dist/registry.json or dist/client (i.e. "run yarn build"
	// first) propagate and fail startup fast, rather than only failing the
	// first CLI call or page load.
	const registry = loadRegistry();
	const clientDir = path.join(getPackageRoot(), "dist", "client");
	const client = { dir: clientDir, template: loadShellTemplate(clientDir) };

	const docs = new DocsService(rootsService, registry);
	const httpServer = http.createServer();

	// One watcher over every mounted root drives the live update signals. It
	// skips hidden, dependency, virtualenv and build trees (see isWatchIgnored)
	// and does not follow symlinks out of a root. Running out of file handles
	// or watches turns live updates off or partial, not the server (see
	// handleWatchErrors).
	const watcher = watch(
		rootsService.list().map((info) => info.dir),
		{
			ignoreInitial: true,
			followSymlinks: false,
			ignored: (changedPath) => isWatchIgnored(rootsService.list(), changedPath),
		},
	);
	const watchErrors = handleWatchErrors(watcher);

	const docCache = new DocCache();
	const search = new SearchService(docCache, new DocumentService(registry, assetUrl));
	const diagrams = restricted
		? undefined
		: new DiagramsService(
				new PreferencesService(path.join(mdxserveHome(), "config.json")),
				localAgentPort(),
				validateDiagram,
				normalizeDiagramImage,
			);
	const diagramWatch = diagrams ? setInterval(() => diagrams.stopIfDisabled(), 1000) : undefined;
	diagramWatch?.unref();
	httpServer.once("close", () => {
		if (diagramWatch) clearInterval(diagramWatch);
		diagrams?.dispose();
	});

	httpServer.on("request", (req, res) => {
		handleRequest(req, res, {
			roots: rootsService,
			registry,
			client,
			docCache,
			search,
			docs,
			diagrams,
			permissions,
		}).catch((error) => {
			console.error(error);
			if (!res.headersSent) {
				res.statusCode = 500;
				res.end("Internal Server Error");
			}
		});
	});

	// Per-process state: the `Host` values `tailscale serve` publishes this
	// server under. Detection needs the port, so it waits for the listener.
	let endpoint: { port: number; boundHost: string } | undefined;
	const tailnetHosts =
		options.tailscale === false
			? undefined
			: serverTailnetHosts(() => endpoint, process.platform, process.env);

	// After the request listener: engine.io takes over the listeners already
	// registered and forwards every request outside its own path to them.
	const realtime = attachRealtime(httpServer, {
		docs,
		permissions,
		acceptsPeer: realtimePeerCheck(permissions, tailnetHosts),
	});

	// Auto-refresh open listings and docs.
	const stopFileSignals = signalFileChanges(watcher, () => rootsService.list(), realtime);

	// Move the watcher with the mounted set. By the time this runs the set has
	// already changed, so nothing in here may reject: a failure would surface
	// as an error on a mutation that did succeed, and a retry would then read
	// as "already mounted". Each step is best-effort and logged; the registry
	// write and the socket broadcast are independent of the watcher and of
	// each other.
	rootsService.onChange(async ({ added, removed, roots: mountedRoots }) => {
		const dirs = mountedRoots.map((info) => info.dir);
		try {
			if (!watchErrors.stopped()) {
				if (removed.length > 0) watcher.unwatch(removed);
				if (added.length > 0) watcher.add(added);
			}
		} catch (error) {
			console.error(error);
		}
		serverRegistry.updateRoots(process.pid, dirs);
		try {
			realtime.rootsChanged();
		} catch (error) {
			console.error(error);
		}
	});

	const stopConfigWatch = rootsService.watchConfig((message) =>
		console.error(`mdxserve: ${message}`),
	);

	const actualPort = await listenWithFallback(httpServer, options.port, host);
	printBanner(actualPort, host, actualPort !== options.port, rootsService.list(), permissions);
	serverRegistry.register({
		port: actualPort,
		pid: process.pid,
		host,
		roots: rootsService.list().map((info) => info.dir),
	});

	// Not awaited: the server is already listening, and a slow or broken CLI
	// must not hold up startup. A missing or stopped Tailscale prints nothing.
	endpoint = { port: actualPort, boundHost: host };
	if (tailnetHosts) {
		void announceTailscale(tailnetHosts, {
			port: actualPort,
			boundHost: host,
			permissions,
			debug: Boolean(process.env.MDXSERVE_DEBUG),
		});
	}

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
		if (diagramWatch) clearInterval(diagramWatch);
		diagrams?.dispose();
		console.log("\n  Shutting down…");
		try {
			stopConfigWatch();
			stopFileSignals();
			realtime.close();
			await watcher.close();
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
