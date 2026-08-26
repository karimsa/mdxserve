import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startServer } from "./http/start.js";
import { loadRegistry, formatComponent, formatComponentTable } from "./components/registry.js";
import { ComponentsService } from "./components/service.js";
import { cleanCache, getCacheHome } from "./infra/cache.js";
import { createMcpServer } from "./mcp/server.js";
import { RemoteClient, serverBaseUrl } from "./servers/remote.js";
import { RootsService } from "./roots/service.js";
import { computeRootInfos, type RootInfo } from "./roots/root-info.js";
import { expandHome } from "./roots/paths.js";
import { ServerRegistry, type ServerRecord } from "./servers/server-registry.js";
import { DocCache } from "./docs/doc-cache.js";
import { SearchService } from "./search/service.js";
import {
	ExportService,
	EXPORT_FORMATS,
	MERMAID_MODES,
	type ExportFormat,
} from "./export/service.js";
import { bundleStandalone } from "./rendering/bundle.js";
import type { MermaidMode } from "./rendering/protocol.js";

const program = new Command();

const NOT_RUNNING = "mdxserve: no server is running; start one with `mdxserve serve -w <dir>`";

/** Connects to the currently running `mdxserve serve` instance, or `undefined` if none is registered. */
function connectToRunningServer(): { record: ServerRecord; remote: RemoteClient } | undefined {
	const serverRegistry = new ServerRegistry();
	const record = serverRegistry.current();
	if (!record) return undefined;
	return { record, remote: new RemoteClient(() => serverRegistry.current()) };
}

/** Resolve a CLI-supplied directory the same way the roots tRPC schema expects: absolute, against this process's cwd (not the server's). */
function resolveRootArg(dir: string): string {
	return path.resolve(process.cwd(), expandHome(dir, os.homedir()));
}

function printDirList(dirs: string[]): void {
	if (dirs.length === 0) {
		console.log("(none)");
		return;
	}
	for (const dir of dirs) console.log(dir);
}

function printRootsMutation(
	verb: "Added" | "Removed",
	changed: string[],
	mountedRoots: RootInfo[],
): void {
	for (const dir of changed) console.log(`${verb} ${dir}`);
	console.log("Now serving:");
	printDirList(mountedRoots.map((rootInfo) => rootInfo.dir));
}

program
	.name("mdxserve")
	.description("Serve a directory of Markdown/MDX files, like `serve` but for docs");

program
	.command("serve", { isDefault: true })
	.description(
		"Start the server; mount folders with -w (repeatable) or later with `mdxserve roots add <dir>`",
	)
	.option("-p, --port <n>", "port to listen on", "4040")
	.option("--host <host>", "host to bind to (use 0.0.0.0 to expose on the LAN)", "127.0.0.1")
	.option(
		"-w, --watch <dir>",
		"serve this directory (repeatable)",
		(value: string, acc: string[]) => acc.concat(value),
		[] as string[],
	)
	.action(async (opts: { port: string; host: string; watch: string[] }) => {
		const inputs = opts.watch;

		// Which directories may be served together — existence, dedupe by
		// realpath, no "/", no nesting — is RootsService's call, not the CLI's.
		const admitted = await new RootsService(process.cwd()).admit(inputs);
		if (admitted.kind !== "ok") {
			console.error(`mdxserve: ${admitted.message}`);
			process.exitCode = 1;
			return;
		}
		const { roots } = admitted;

		const port = Number.parseInt(opts.port, 10);
		if (Number.isNaN(port)) {
			console.error(`mdxserve: invalid port: ${opts.port}`);
			process.exitCode = 1;
			return;
		}

		const outcome = await startServer({ roots, port, host: opts.host });
		if (outcome.kind === "ok") return;
		process.exitCode = 1;
		if (outcome.kind === "error") {
			console.error(`mdxserve: ${outcome.message}`);
			return;
		}
		if (outcome.port === undefined) {
			console.error(
				`mdxserve: a server is already starting (pid ${outcome.pid}); run \`mdxserve status\` in a moment`,
			);
			return;
		}
		const url = serverBaseUrl({ host: outcome.host ?? "127.0.0.1", port: outcome.port });
		console.error(
			[
				`mdxserve: a server is already running (pid ${outcome.pid}) at ${url}`,
				"  add a folder to it:      mdxserve roots add <dir>",
				"  see what it is serving:  mdxserve status",
				"  stop it (Ctrl-C, or your process manager) before starting another",
			].join("\n"),
		);
	});

program
	.command("export <file>")
	.description("Export one .md/.mdx file to a single self-contained file")
	.option("-o, --out <file>", "output file path (default: <name>.<ext> in the current directory)")
	.option("-f, --format <format>", "output format", "html")
	.option("--mermaid <mode>", "mermaid handling: cdn, bundle, or none", "cdn")
	.action(async (file: string, opts: { out?: string; format: string; mermaid: string }) => {
		if (!(EXPORT_FORMATS as readonly string[]).includes(opts.format)) {
			console.error(
				`mdxserve: unsupported format "${opts.format}" (supported: ${EXPORT_FORMATS.join(", ")})`,
			);
			process.exitCode = 1;
			return;
		}
		if (!MERMAID_MODES.includes(opts.mermaid as MermaidMode)) {
			console.error(
				`mdxserve: invalid --mermaid mode "${opts.mermaid}" (expected: ${MERMAID_MODES.join(", ")})`,
			);
			process.exitCode = 1;
			return;
		}

		// Same treatment as every other path the CLI takes: a leading `~` is
		// expanded here, since a quoted or non-shell-supplied argument arrives
		// with it still literal.
		const docPath = path.resolve(process.cwd(), expandHome(file, os.homedir()));
		const outFile = opts.out
			? path.resolve(process.cwd(), expandHome(opts.out, os.homedir()))
			: undefined;
		// `export` is independent of the one-server-per-user model: it never
		// acquires ServerLock and never reads ServerRegistry, so it runs
		// whether or not `mdxserve serve` is up.
		const exportService = new ExportService(bundleStandalone);
		const result = await exportService.export({
			docPath,
			outFile,
			format: opts.format as ExportFormat,
			mermaid: opts.mermaid as MermaidMode,
		});

		if (result.kind === "ok") {
			for (const warning of result.warnings) console.error(`mdxserve: warning: ${warning}`);
			const kilobytes = (result.bytes / 1024).toFixed(0);
			console.log(
				`Wrote ${result.outFile} (${kilobytes} KB, ${opts.format}, mermaid: ${result.mermaid})`,
			);
			return;
		}
		console.error(`mdxserve: ${result.message}`);
		process.exitCode = 1;
	});

program
	.command("mcp")
	.description("Run the MCP server over stdio (for Claude Code, Codex, …)")
	.action(async () => {
		let registry;
		try {
			registry = loadRegistry();
		} catch (error) {
			console.error((error as Error).message);
			process.exitCode = 1;
			return;
		}

		// The one running `mdxserve serve` keeps its pid/port/roots current in
		// the server registry; this bridge reads that row fresh per tool call
		// (a tiny sqlite open, nowhere near a hot path) and proxies
		// `validate_doc`, `search_docs`, `list_docs`, and the root mutations to
		// it over a tRPC client (src/servers/remote.ts) so the server's warm
		// search index and render worker are the single source of truth — the
		// stdio bridge has neither. An `unavailable` outcome (no server, or the
		// request itself fails — e.g. a registry row surviving a crash before
		// its pid check catches up) falls back to local, static-only handling
		// inside createMcpServer. The bridge never starts a server itself.
		const serverRegistry = new ServerRegistry();
		const docCache = new DocCache();
		const search = new SearchService(docCache);
		const server = createMcpServer({
			registry,
			serverRunning: () => serverRegistry.current() !== undefined,
			getRoots: () => computeRootInfos(serverRegistry.current()?.roots ?? []),
			remote: new RemoteClient(() => serverRegistry.current()),
			docCache,
			search,
		});

		const transport = new StdioServerTransport();
		await server.connect(transport); // keeps the process alive until stdin closes
	});

const roots = program.command("roots").description("Manage the folders the running server serves");

roots
	.command("add <dirs...>")
	.description("Mount one or more directories on the running server")
	.action(async (dirs: string[]) => {
		const connection = connectToRunningServer();
		if (!connection) {
			console.error(NOT_RUNNING);
			process.exitCode = 1;
			return;
		}

		const outcome = await connection.remote.addRoots(dirs.map(resolveRootArg));
		if (outcome.kind === "ok") {
			printRootsMutation("Added", outcome.value.added, outcome.value.roots);
			return;
		}
		process.exitCode = 1;
		if (outcome.kind === "error") {
			console.error(`mdxserve: ${outcome.message}`);
			return;
		}
		console.error(NOT_RUNNING);
	});

roots
	.command("remove <dirs...>")
	.description("Unmount one or more directories from the running server")
	.action(async (dirs: string[]) => {
		const connection = connectToRunningServer();
		if (!connection) {
			console.error(NOT_RUNNING);
			process.exitCode = 1;
			return;
		}

		const outcome = await connection.remote.removeRoots(dirs.map(resolveRootArg));
		if (outcome.kind === "ok") {
			printRootsMutation("Removed", outcome.value.removed, outcome.value.roots);
			return;
		}
		process.exitCode = 1;
		if (outcome.kind === "error") {
			console.error(`mdxserve: ${outcome.message}`);
			return;
		}
		console.error(NOT_RUNNING);
	});

roots
	.command("list")
	.description("List the folders the running server serves")
	.action(async () => {
		const connection = connectToRunningServer();
		if (!connection) {
			console.error(NOT_RUNNING);
			process.exitCode = 1;
			return;
		}

		const outcome = await connection.remote.listRoots();
		if (outcome.kind === "ok") {
			printDirList(outcome.value.roots.map((rootInfo) => rootInfo.dir));
			return;
		}
		process.exitCode = 1;
		if (outcome.kind === "error") {
			console.error(`mdxserve: ${outcome.message}`);
			return;
		}
		console.error(NOT_RUNNING);
	});

program
	.command("status")
	.description("Show the running server's pid, port, and served folders")
	.option("--json", "print the server record as JSON")
	.action((opts: { json?: boolean }) => {
		const serverRegistry = new ServerRegistry();
		const record = serverRegistry.current();
		if (!record) {
			console.error(NOT_RUNNING);
			process.exitCode = 1;
			return;
		}

		if (opts.json) {
			console.log(JSON.stringify(record, null, 2));
			return;
		}

		console.log(`pid:   ${record.pid}`);
		console.log(`port:  ${record.port}`);
		console.log(`url:   ${serverBaseUrl(record)}`);
		console.log("roots:");
		if (record.roots.length === 0) {
			console.log("  (none)");
		} else {
			for (const dir of record.roots) console.log(`  ${dir}`);
		}
	});

const components = program
	.command("components")
	.description("Inspect the builtin component registry");

components
	.command("search [query]")
	.description("Search builtin components by name, description, or prop")
	.option("--json", "print matches as JSON")
	.action((query: string | undefined, opts: { json?: boolean }) => {
		let registry;
		try {
			registry = loadRegistry();
		} catch (error) {
			console.error((error as Error).message);
			process.exitCode = 1;
			return;
		}

		const matches = new ComponentsService(registry).list(query);

		if (opts.json) {
			console.log(JSON.stringify(matches, null, 2));
			return;
		}

		if (matches.length === 0) {
			console.error(`No components match "${query ?? ""}".`);
			return;
		}

		console.log(formatComponentTable(matches));
	});

components
	.command("show <name>")
	.description("Show details for a builtin component")
	.option("--json", "print the raw registry entry as JSON")
	.action((name: string, opts: { json?: boolean }) => {
		let registry;
		try {
			registry = loadRegistry();
		} catch (error) {
			console.error((error as Error).message);
			process.exitCode = 1;
			return;
		}

		const componentsService = new ComponentsService(registry);
		const entry = componentsService.find(name);

		if (!entry) {
			console.error(`Unknown component "${name}".`);
			const suggestions = componentsService.suggest(name);
			if (suggestions.length > 0) {
				console.error(`Did you mean: ${suggestions.join(", ")}?`);
			}
			process.exitCode = 1;
			return;
		}

		if (opts.json) {
			console.log(JSON.stringify(entry, null, 2));
			return;
		}

		console.log(formatComponent(entry));
	});

const cache = program
	.command("cache")
	.description("Manage the dependency cache (~/.cache/mdxserve/)");

cache
	.command("clean")
	.description("Delete the dependency cache; the next `serve` rebuilds it")
	.action(() => {
		const removed = cleanCache();
		console.log(removed ? `Removed ${getCacheHome()}` : `Nothing to clean at ${getCacheHome()}`);
	});

await program.parseAsync(process.argv);
