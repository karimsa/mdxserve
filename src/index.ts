import { Command } from "commander";
import os from "node:os";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startServer } from "./http/start.js";
import { loadRegistry, formatComponent, formatComponentTable } from "./components/registry.js";
import { ComponentsService } from "./components/service.js";
import { cleanCache, getCacheDir } from "./infra/cache.js";
import { createMcpServer } from "./mcp/server.js";
import { RemoteDocsClient } from "./servers/remote.js";
import { expandHome } from "./roots/paths.js";
import { RootsService } from "./roots/service.js";
import { ServerRegistry } from "./servers/server-registry.js";
import { DocCache } from "./docs/doc-cache.js";
import { SearchService } from "./search/service.js";

const program = new Command();

program
	.name("mdxserve")
	.description("Serve a directory of Markdown/MDX files, like `serve` but for docs");

program
	.command("serve [dir]", { isDefault: true })
	.description("Serve a directory of Markdown/MDX files")
	.option("-p, --port <n>", "port to listen on", "4040")
	.option("--host <host>", "host to bind to (use 0.0.0.0 to expose on the LAN)", "127.0.0.1")
	.option(
		"-w, --watch <dir>",
		"serve this directory (repeatable)",
		(value: string, acc: string[]) => acc.concat(value),
		[] as string[],
	)
	.action(
		async (
			dir: string | undefined,
			opts: {
				port: string;
				host: string;
				watch: string[];
			},
		) => {
			const inputs = [...opts.watch, ...(dir ? [dir] : [])];

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

			await startServer({ roots, port, host: opts.host });
		},
	);

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

		// Every `mdxserve serve` registers itself in the server registry; this
		// bridge searches/lists across the union of their roots (already
		// realpaths, so string dedupe is enough; nested roots from separate
		// servers collapse to the outer one) so a single stdio registration
		// works no matter which `mdxserve serve` is running. `validate_doc`,
		// `search_docs`, and `list_docs` proxy to the owning live server(s)
		// over a tRPC client (src/servers/remote.ts) so the server's warm search index
		// and render worker are the single source of truth — the stdio bridge
		// has neither. A `null`/`unavailable` outcome (no owning server, or the
		// request itself fails — e.g. a registry row surviving a crash before
		// its pid check catches up) falls back to local, static-only handling
		// inside createMcpServer.
		const serverRegistry = new ServerRegistry();
		const rootsService = new RootsService(process.cwd());
		const docCache = new DocCache();
		const search = new SearchService(docCache);
		const server = createMcpServer({
			registry,
			getRoots: () =>
				rootsService.reconcile(serverRegistry.live().flatMap((serverRecord) => serverRecord.roots)),
			remote: new RemoteDocsClient(() => serverRegistry.live()),
			docCache,
			search,
		});

		const transport = new StdioServerTransport();
		await server.connect(transport); // keeps the process alive until stdin closes
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
	.description("Manage the per-directory cache (~/.cache/mdxserve/<dir>-<hash>/)");

cache
	.command("clean [dir]")
	.description("Delete the cache for a served directory (defaults to the current directory)")
	.action((dir: string | undefined) => {
		const root = path.resolve(process.cwd(), expandHome(dir ?? ".", os.homedir()));
		const removed = cleanCache(root);
		console.log(
			removed ? `Removed ${getCacheDir(root)}` : `Nothing to clean at ${getCacheDir(root)}`,
		);
	});

await program.parseAsync(process.argv);
