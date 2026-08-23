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
  /** Git poll interval in ms. */
  intervalMs?: number;
  /** dist/ poll interval in ms. */
  distIntervalMs?: number;
  /** Branch to track on `origin`. */
  branch?: string;
}

function log(message: string): void {
  console.log(`[auto-update] ${message}`);
}

/**
 * Run the server as a child process and keep it current. Two independent
 * pollers do the work:
 *
 * - A git poller (only when the checkout is on `<branch>`) compares
 *   `origin/<branch>` against the last commit it built; when it moves, the
 *   checkout is pulled (rebase), dependencies installed, and the CLI rebuilt.
 *   It never restarts the server itself.
 * - A dist poller watches the mtime of `dist/cli.js` and restarts the child
 *   whenever it changes, whether from the git poller or a local `yarn build`.
 *
 * The supervisor itself keeps running the code it started with; it is
 * deliberately small so that rarely matters.
 */
export async function runSupervisor(options: SupervisorOptions): Promise<number> {
  const {
    cliArgs,
    intervalMs = Number(process.env.MDXSERVE_UPDATE_INTERVAL_MS) || 60_000,
    distIntervalMs = Number(process.env.MDXSERVE_DIST_INTERVAL_MS) || 2_000,
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
  // Set only while the server is being stopped/respawned on purpose, so the
  // exit handler can tell a deliberate restart from a crash.
  let restarting = false;

  const spawnChild = (): ChildProcess => {
    const proc = spawn(process.execPath, cliArgs, {
      stdio: "inherit",
      env: { ...process.env, [SUPERVISED_ENV]: "1" },
    });
    proc.on("exit", (code, signal) => {
      if (shuttingDown || restarting) return;
      if (updating) {
        // `yarn install` is rewriting node_modules under the live server
        // (the bundle keeps packages external); respawn once the update settles.
        log(`server exited (${signal ?? code}) during an update; respawning when it finishes`);
        return;
      }
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

  const restartChild = async (): Promise<void> => {
    restarting = true;
    try {
      await stopChild();
      child = spawnChild();
    } finally {
      restarting = false;
    }
  };

  // ---- dist poller: restart the child whenever the built bundle changes ----

  const bundlePath = path.join(repo, "dist", "cli.js");
  const bundleMtime = (): number => {
    try {
      return fs.statSync(bundlePath).mtimeMs;
    } catch {
      return 0;
    }
  };
  let lastBundleMtime = bundleMtime();

  const checkForRebuild = async (): Promise<void> => {
    if (restarting || shuttingDown) return;
    const mtime = bundleMtime();
    if (mtime === lastBundleMtime) return;
    lastBundleMtime = mtime;
    log(`${path.relative(repo, bundlePath)} changed on disk; restarting server`);
    await restartChild();
  };

  // ---- git poller: pull, install, and build when origin/<branch> moves ----

  const localHead = async () => (await $`git rev-parse HEAD`).stdout.trim();
  const localBranch = async () => (await $`git rev-parse --abbrev-ref HEAD`).stdout.trim();
  const remoteHead = async () => {
    const out = (await $`git ls-remote origin refs/heads/${branch}`).stdout.trim();
    return out.split(/\s+/)[0] ?? "";
  };

  // The commit last successfully built. Compared against origin instead of raw
  // HEAD so a pull that succeeds but whose install/build fails is retried on
  // the next poll rather than treated as done.
  let builtHead = "";
  let updating = false;

  const checkForUpdate = async (): Promise<void> => {
    // Claim the guard before any await so overlapping interval ticks can't
    // both get past it and run git concurrently on the same checkout.
    if (updating || shuttingDown) return;
    updating = true;
    try {
      let remote: string;
      try {
        remote = await remoteHead();
      } catch (error) {
        log(`could not reach origin: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (!remote || remote === builtHead) return;

      const local = await localHead();
      log(`origin/${branch} at ${remote.slice(0, 7)} (built ${builtHead.slice(0, 7)}, local ${local.slice(0, 7)}); updating`);
      try {
        try {
          await $`git pull --rebase origin ${branch}`;
        } catch (error) {
          // Don't leave a half-applied rebase behind; the next poll retries.
          await $`git rebase --abort`.catch(() => {});
          throw error;
        }
        await $`yarn install`;
        await $`yarn build`;
        builtHead = await localHead();
        log(`built ${builtHead.slice(0, 7)}; the dist poller will restart the server`);
      } catch (error) {
        const stderr = (error as { stderr?: string }).stderr?.trim();
        log(`update failed: ${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ""}`);
        log("keeping the current server running");
      }
    } finally {
      updating = false;
      if (!shuttingDown && child && (child.exitCode !== null || child.signalCode !== null)) {
        log("server died during the update; respawning");
        child = spawnChild();
      }
    }
  };

  const timers: NodeJS.Timeout[] = [];
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const timer of timers) clearInterval(timer);
    await stopChild();
    process.exit(signal === "SIGINT" ? 130 : 0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  child = spawnChild();
  timers.push(setInterval(() => void checkForRebuild(), distIntervalMs));
  log(`watching ${path.relative(repo, bundlePath)} every ${distIntervalMs}ms`);

  const current = await localBranch();
  if (current === branch) {
    builtHead = await localHead();
    log(`watching origin/${branch} of ${repo} every ${Math.round(intervalMs / 1000)}s (at ${builtHead.slice(0, 7)})`);
    timers.push(setInterval(() => void checkForUpdate(), intervalMs));
  } else {
    log(`checkout is on ${current}, not ${branch}; git auto-update disabled`);
  }

  return new Promise<number>(() => {
    // Resolved only via process.exit in the handlers above.
  });
}
