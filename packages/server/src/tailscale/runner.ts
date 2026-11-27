import os from "node:os";
import { runProcess } from "../infra/process-runner.js";
import type { TailscaleRunner } from "./service.js";

/** Each Tailscale CLI call gets this long before it is killed. */
const CALL_TIMEOUT_MS = 2000;
/** `serve status --json` for a busy tailnet is a few kilobytes. */
const MAX_OUTPUT_BYTES = 256 * 1024;

/**
 * Runs the CLI through the one process-spawning adapter, bounded in time and
 * output. A missing executable keeps its `ENOENT` code; any other failure is
 * reworded, since the adapter's own messages speak of diagram agents.
 */
export function tailscaleRunner(): TailscaleRunner {
	return (command, args) =>
		runProcess(command, args, {
			cwd: os.tmpdir(),
			// The macOS app's binary is the GUI and the CLI in one. It acts as the CLI when it
			// finds a terminal in its environment; under a process manager there is none, and it
			// hangs. This variable makes it the CLI in every environment.
			env: { ...process.env, TAILSCALE_BE_CLI: "1" },
			signal: new AbortController().signal,
			timeoutMs: CALL_TIMEOUT_MS,
			maxBytes: MAX_OUTPUT_BYTES,
		}).catch((error: unknown) => {
			if ((error as { code?: unknown } | null)?.code === "ENOENT") throw error;
			throw new Error(
				`did not finish within ${CALL_TIMEOUT_MS / 1000} s with at most ${MAX_OUTPUT_BYTES / 1024} KB of output, or could not be started`,
			);
		});
}
