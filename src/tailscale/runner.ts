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
