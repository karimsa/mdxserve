import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./server.js";
import { loadRegistry, searchRegistry, formatComponent, suggest } from "./registry.js";
import { cleanCache, getCacheDir } from "./cache.js";

const program = new Command();

program.name("mdxserve").description("Serve a directory of Markdown/MDX files, like `serve` but for docs");

program
  .command("serve [dir]", { isDefault: true })
  .description("Serve a directory of Markdown/MDX files")
  .option("-p, --port <n>", "port to listen on", "4040")
  .option("--host <host>", "host to bind to", "0.0.0.0")
  .action(async (dir: string | undefined, opts: { port: string; host: string }) => {
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

    await startServer({ root, port, host: opts.host });
  });

const components = program.command("components").description("Inspect the builtin component registry");

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
    console.log(removed ? `Removed ${getCacheDir(root)}` : `Nothing to clean at ${getCacheDir(root)}`);
  });

await program.parseAsync(process.argv);
