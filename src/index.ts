import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startServer } from "./server.js";
import { loadRegistry, searchRegistry, formatComponent, suggest } from "./registry.js";
import { cleanCache, getCacheDir } from "./cache.js";
import { createMcpServer } from "./mcp.js";
import { createRemote } from "./remote.js";
import { computeRootInfos, pruneNestedRoots } from "./roots.js";
import { liveServers } from "./server-registry.js";

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
		(v: string, acc: string[]) => acc.concat(v),
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
			if (inputs.length === 0) inputs.push(".");

			const resolved = inputs.map((d) => path.resolve(process.cwd(), d));

			for (const dirAbs of resolved) {
				if (!fs.existsSync(dirAbs)) {
					console.error(`mdxserve: no such directory: ${dirAbs}`);
					process.exitCode = 1;
					return;
				}

				if (!fs.statSync(dirAbs).isDirectory()) {
					console.error(`mdxserve: not a directory: ${dirAbs}`);
					process.exitCode = 1;
					return;
				}
			}

			// Dedupe by realpath, not the resolved string, so a symlinked alias of
			// an already-mounted root isn't served twice — and keep the realpath'd
			// value since Vite's fs.allow compares real paths.
			const seen = new Set<string>();
			const roots: string[] = [];
			for (const dirAbs of resolved) {
				const real = fs.realpathSync(dirAbs);
				if (seen.has(real)) continue;
				seen.add(real);
				roots.push(real);
			}

			if (roots.includes("/")) {
				console.error("mdxserve: refusing to serve /");
				process.exitCode = 1;
				return;
			}

			// Reject nested roots: they'd make resolveRoot's first-match ambiguous
			// and would list/index the same docs twice.
			for (const a of roots) {
				for (const b of roots) {
					if (a === b) continue;
					const rel = path.relative(a, b);
					if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
						console.error(`mdxserve: ${b} is inside ${a}; serve only the outer one`);
						process.exitCode = 1;
						return;
					}
				}
			}

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
		// over a tRPC client (src/remote.ts) so the server's warm search index
		// and render worker are the single source of truth — the stdio bridge
		// has neither. A `null`/`unavailable` outcome (no owning server, or the
		// request itself fails — e.g. a registry row surviving a crash before
		// its pid check catches up) falls back to local, static-only handling
		// inside createMcpServer.
		const server = createMcpServer({
			registry,
			getRoots: () =>
				computeRootInfos(
					pruneNestedRoots(liveServers().flatMap((serverRecord) => serverRecord.roots)),
				),
			remote: createRemote(),
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

		const matches = searchRegistry(registry, query);

		if (opts.json) {
			console.log(JSON.stringify(matches, null, 2));
			return;
		}

		if (matches.length === 0) {
			console.error(`No components match "${query ?? ""}".`);
			return;
		}

		const width = Math.max(...matches.map((m) => m.name.length));
		for (const match of matches) {
			console.log(`${match.name.padEnd(width)}  ${match.description}`);
		}
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

		const entry = registry.components.find((c) => c.name.toLowerCase() === name.toLowerCase());

		if (!entry) {
			console.error(`Unknown component "${name}".`);
			const suggestions = suggest(registry, name);
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

const cache = program.command("cache").description("Manage the per-directory cache (.mdxserve/)");

cache
	.command("clean [dir]")
	.description("Delete the cache for a served directory (defaults to the current directory)")
	.action((dir: string | undefined) => {
		const root = path.resolve(process.cwd(), dir ?? ".");
		const removed = cleanCache(root);
		console.log(
			removed ? `Removed ${getCacheDir(root)}` : `Nothing to clean at ${getCacheDir(root)}`,
		);
	});

await program.parseAsync(process.argv);
