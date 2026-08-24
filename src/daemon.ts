import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface DaemonOptions {
	roots: string[];
	port: number;
	host: string;
	name: string;
}

function hasOxmgr(): boolean {
	const probe = spawnSync("oxmgr", ["--version"], { stdio: "ignore" });
	return !probe.error && probe.status === 0;
}

/** Shell-quote a single argument for the command string oxmgr will run. */
function quote(arg: string): string {
	return /^[A-Za-z0-9_./:=@%+-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/**
 * Register this server with oxmgr as a managed background process. Runs the
 * same CLI entry (`node <this cli>`) so it works whether mdxserve was
 * installed globally, linked, or run from a checkout.
 */
export function daemonize(options: DaemonOptions): number {
	if (!hasOxmgr()) {
		console.error(
			"mdxserve: --daemon needs oxmgr, which was not found on PATH.\n" +
				"  Install it (e.g. `brew install oxmgr` or `cargo install oxmgr`) and retry.",
		);
		return 1;
	}

	const cli = fileURLToPath(import.meta.url);
	if (cli.endsWith(".ts")) {
		console.error(
			"mdxserve: --daemon needs the built CLI (run `yarn build`, or use the installed `mdxserve` binary).",
		);
		return 1;
	}
	const args = [
		process.execPath,
		cli,
		"serve",
		...options.roots.flatMap((r) => ["-w", r]),
		"-p",
		String(options.port),
		"--host",
		options.host,
	];
	const command = args.map(quote).join(" ");

	const result = spawnSync(
		"oxmgr",
		["start", "--name", options.name, "--cwd", options.roots[0], command],
		{
			stdio: "inherit",
		},
	);
	if (result.error || result.status !== 0) {
		console.error(`mdxserve: oxmgr start failed${result.error ? `: ${result.error.message}` : ""}`);
		return result.status ?? 1;
	}

	console.log(`
mdxserve is running in the background as "${options.name}" (managed by oxmgr).

  http://localhost:${options.port}
  http://localhost:${options.port}/__mdxserve/mcp   (MCP)

  oxmgr logs ${options.name}      tail the server log
  oxmgr stop ${options.name}      stop it (keeps the registration)
  oxmgr delete ${options.name}    stop and forget it
`);
	return 0;
}
