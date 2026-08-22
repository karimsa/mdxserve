import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./server.js";

const program = new Command();

program
  .name("mdxserve")
  .description("Serve a directory of Markdown/MDX files, like `serve` but for docs")
  .argument("[dir]", "directory to serve", ".")
  .option("-p, --port <n>", "port to listen on", "4040")
  .option("--host <host>", "host to bind to", "0.0.0.0")
  .action(async (dir: string, opts: { port: string; host: string }) => {
    const root = path.resolve(process.cwd(), dir);

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

await program.parseAsync(process.argv);
