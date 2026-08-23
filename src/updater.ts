import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { $ } from "zx";
import { getPackageRoot } from "./pkg.js";

/** Env var that marks the server process spawned by the supervisor. */
export const SUPERVISED_ENV = "MDXSERVE_SUPERVISED";

export interface SupervisorOptions {
  /** argv to run the server with (everything after the node binary). */
  cliArgs: string[];
  /** Poll interval in ms. */
  intervalMs?: number;
  /** Branch to track on `origin`. */
  branch?: string;
}

function log(message: string): void {
  console.log(`[auto-update] ${message}`);
}

/**
 * Run the server as a child process and keep it current with `origin/<branch>`
 * of the mdxserve checkout this CLI was built from. Every interval the remote
 * ref is compared against the local HEAD; when it moves, the checkout is
 * pulled (rebase), dependencies installed, the CLI rebuilt, and the child
 * restarted so it loads the fresh build.
 *
 * The supervisor itself keeps running the code it started with; it is
 * deliberately small so that rarely matters.
 */
export async function runSupervisor(options: SupervisorOptions): Promise<number> {
  const {
    cliArgs,
    intervalMs = Number(process.env.MDXSERVE_UPDATE_INTERVAL_MS) || 60_000,
    branch = "main",
  } = options;
  const repo = getPackageRoot();

  if (!fs.existsSync(path.join(repo, ".git"))) {
    console.error(`mdxserve: --auto-update needs a git checkout, but ${repo} is not one.`);
    return 1;
  }

  // zx runs git/yarn inside the checkout; make sure the node that runs us (and
  // its sibling yarn/corepack shims) is on PATH even under a bare service env.
  $.cwd = repo;
  $.quiet = true;
  $.env = { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ""}` };

  let child: ChildProcess | null = null;
  let shuttingDown = false;
  let updating = false;

  const spawnChild = (): ChildProcess => {
    const proc = spawn(process.execPath, cliArgs, {
      stdio: "inherit",
      env: { ...process.env, [SUPERVISED_ENV]: "1" },
    });
    proc.on("exit", (code, signal) => {
      if (shuttingDown || updating) return;
      // The server died on its own; surface that and give up rather than spin.
      console.error(`mdxserve: server exited (${signal ?? code}); auto-update supervisor stopping.`);
      process.exit(typeof code === "number" ? code : 1);
    });
    return proc;
  };

  const stopChild = async (): Promise<void> => {
    const proc = child;
    if (!proc || proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => proc.kill("SIGKILL"), 10_000);
      proc.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      proc.kill("SIGTERM");
    });
  };

  const localHead = async () => (await $`git rev-parse HEAD`).stdout.trim();
  const remoteHead = async () => {
    const out = (await $`git ls-remote origin refs/heads/${branch}`).stdout.trim();
    return out.split(/\s+/)[0] ?? "";
  };

  const checkForUpdate = async (): Promise<void> => {
    if (updating || shuttingDown) return;
    let remote: string;
    try {
      remote = await remoteHead();
    } catch (error) {
      log(`could not reach origin: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (!remote) return;
    const local = await localHead();
    if (remote === local) return;

    updating = true;
    log(`origin/${branch} moved to ${remote.slice(0, 7)} (local ${local.slice(0, 7)}); updating`);
    try {
      await $`git pull --rebase origin ${branch}`;
      await $`yarn install`;
      await $`yarn build`;
      log("rebuilt; restarting server");
      await stopChild();
      child = spawnChild();
      log(`running ${(await localHead()).slice(0, 7)}`);
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr?.trim();
      log(`update failed: ${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ""}`);
      log("keeping the current server running");
      if (!child || child.exitCode !== null) child = spawnChild();
    } finally {
      updating = false;
    }
  };

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(timer);
    await stopChild();
    process.exit(signal === "SIGINT" ? 130 : 0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  log(`watching origin/${branch} of ${repo} every ${Math.round(intervalMs / 1000)}s (at ${(await localHead()).slice(0, 7)})`);
  child = spawnChild();
  const timer = setInterval(() => void checkForUpdate(), intervalMs);

  return new Promise<number>(() => {
    // Resolved only via process.exit in the handlers above.
  });
}
