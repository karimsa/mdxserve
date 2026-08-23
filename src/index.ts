import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./server.js";
import { loadRegistry, searchRegistry, formatComponent, suggest } from "./registry.js";
import { cleanCache, getCacheDir } from "./cache.js";
import { daemonize } from "./daemon.js";
import { runSupervisor, SUPERVISED_ENV } from "./updater.js";

const program = new Command();

program
	.name("mdxserve")
	.description("Serve a directory of Markdown/MDX files, like `serve` but for docs");

program
	.command("serve [dir]", { isDefault: true })
	.description("Serve a directory of Markdown/MDX files")
	.option("-p, --port <n>", "port to listen on", "4040")
	.option("--host <host>", "host to bind to (use 0.0.0.0 to expose on the LAN)", "127.0.0.1")
	.option("-D, --daemon", "run in the background as an oxmgr-managed process")
	.option("--name <name>", "process name to register with oxmgr (with --daemon)", "mdxserve")
	.option(
		"-w, --wd <folder>",
		"change into this folder first; [dir] is then resolved relative to it",
	)
	.option(
		"-A, --auto-update",
		"poll the mdxserve checkout's origin/main every minute; pull, rebuild, and restart on change",
	)
	.action(
		async (
			dir: string | undefined,
			opts: {
				port: string;
				host: string;
				daemon?: boolean;
				name: string;
				wd?: string;
				autoUpdate?: boolean;
			},
		) => {
			if (opts.wd) {
				const wd = path.resolve(process.cwd(), opts.wd);
				try {
					process.chdir(wd);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.error(`mdxserve: cannot change into ${wd}: ${message}`);
					process.exitCode = 1;
					return;
				}
			}

			const root = path.resolve(process.cwd(), dir ?? ".");

			if (!fs.existsSync(root)) {
				console.error(`mdxserve: no such directory: ${root}`);
				process.exitCode = 1;
				return;
			}

			if (!fs.statSync(root).isDirectory()) {
				console.error(`mdxserve: not a directory: ${root}`);
				process.exitCode = 1;
				return;
			}

			const port = Number.parseInt(opts.port, 10);
			if (Number.isNaN(port)) {
				console.error(`mdxserve: invalid port: ${opts.port}`);
				process.exitCode = 1;
				return;
			}

			if (opts.daemon) {
				process.exitCode = daemonize({
					root,
					port,
					host: opts.host,
					name: opts.name,
					autoUpdate: Boolean(opts.autoUpdate),
				});
				return;
			}

			if (opts.autoUpdate && !process.env[SUPERVISED_ENV]) {
				// Re-run ourselves as a supervised child with the same arguments; the
				// child sees SUPERVISED_ENV and just serves.
				process.exitCode = await runSupervisor({ cliArgs: process.argv.slice(1) });
				return;
			}

			await startServer({ root, port, host: opts.host });
		},
	);

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
