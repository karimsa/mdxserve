import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { createServer } from "vite";
import { $ } from "zx";

/**
 * `yarn dev`: the backend from source (tsx) serving `example/`, and a Vite dev server for
 * `client/` in front of it with HMR. Vite proxies `/__mdxserve` (tRPC, getAsset and the
 * live update socket) to the backend and asks it for each page's shell (scripts/dev-shell.ts).
 *
 * The backend runs on a free port under its own `MDXSERVE_HOME` unless one is set, so it
 * never meets the one-server-per-user lock of a server already running on this machine.
 * Extra arguments go to `mdxserve serve` (for example `-w ~/notes`).
 */

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			const port = typeof address === "object" && address ? address.port : 0;
			probe.close(() => resolve(port));
		});
	});
}

function waitForPort(port: number, backend: ChildProcess): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		backend.once("exit", (code) => reject(new Error(`the backend exited with code ${code}`)));
		const attempt = () => {
			const socket = net.connect(port, "127.0.0.1");
			socket.once("connect", () => {
				socket.end();
				resolve();
			});
			socket.once("error", () => {
				socket.destroy();
				if (Date.now() - started > 60_000) reject(new Error("the backend did not start"));
				else setTimeout(attempt, 200);
			});
		};
		attempt();
	});
}

await $`tsx scripts/build.ts`;

const port = Number(process.env.MDXSERVE_DEV_BACKEND_PORT) || (await freePort());
const home = process.env.MDXSERVE_HOME ?? path.resolve("node_modules/.cache/mdxserve-dev");
const extraArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const serveArgs = extraArgs.some((arg) => arg === "-w" || arg.startsWith("--watch"))
	? extraArgs
	: ["-w", "example", ...extraArgs];
const backend = spawn("tsx", ["src/index.ts", "serve", "-p", String(port), ...serveArgs], {
	stdio: "inherit",
	env: { ...process.env, MDXSERVE_HOME: home },
});
await waitForPort(port, backend);

process.env.MDXSERVE_DEV_BACKEND = `http://127.0.0.1:${port}`;
const vite = await createServer({ configFile: "vite.config.ts" });
await vite.listen();
vite.printUrls();

let stopping = false;
async function stop(): Promise<void> {
	if (stopping) return;
	stopping = true;
	backend.kill("SIGTERM");
	await vite.close();
	process.exit(0);
}
backend.on("exit", () => void stop());
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
