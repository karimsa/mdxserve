import fs from "node:fs";
import path from "node:path";
// CJS package: default-import it and read the functions off the namespace
// (a named import would resolve at type-check time but not at runtime under
// node's ESM loader for this module shape).
import lockfile from "lockfile";
import { isAlive, mdxserveHome } from "./server-registry.js";

/** Max attempts (an initial try plus steals of a dead/stale lock) before giving up. */
const MAX_ATTEMPTS = 3;

/** A lockfile younger than this is presumed mid-write by another starter, not stale garbage. */
const WRITE_IN_PROGRESS_MS = 1000;

export type AcquireOutcome =
	{ kind: "ok" } | { kind: "held"; pid: number } | { kind: "error"; message: string };

/** `<mdxserveHome>/server.lock`. */
export function defaultLockPath(): string {
	return path.join(mdxserveHome(), "server.lock");
}

/** The pid a lockfile holds, or undefined unless its content is exactly one positive integer. */
export function parseLockPid(content: string): number | undefined {
	const trimmed = content.trim();
	if (!/^\d+$/.test(trimmed)) return undefined;
	const pid = Number.parseInt(trimmed, 10);
	return pid > 0 && Number.isSafeInteger(pid) ? pid : undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Enforces "one `mdxserve serve` per user" with a pid lockfile: `acquire`
 * creates the file exclusively, refusing to start when a live process
 * already holds it; `release` removes it on shutdown.
 *
 * The exclusive create, the unlink, and the "remove every lock this process
 * still holds when it exits" safety net come from the `lockfile` package.
 * Its own staleness rule is mtime-based (a lock older than `stale` ms is
 * taken), which would need a long-running server to keep touching the file;
 * instead the holder's pid is written into the lock and a dead pid is what
 * makes it stale — so a crashed server's lock is reclaimed immediately and a
 * healthy one is never mistaken for abandoned.
 *
 * Known limitation: if a process crashes and its pid gets reused by an
 * unrelated process before the next `serve` looks at the lockfile, that
 * unrelated pid reads as "alive" and the lock reads as held. `mdxserve
 * status` prints the pid so a user hitting this can identify and delete the
 * stale lockfile by hand.
 */
export class ServerLock {
	private held = false;

	constructor(private readonly lockPath: string = defaultLockPath()) {}

	/**
	 * Try to create the lockfile exclusively. On `EEXIST`, inspects the
	 * existing file: a live pid means the lock is genuinely held; a dead pid,
	 * or content stale enough not to be a concurrent starter mid-write, is
	 * removed and the attempt retried (up to `MAX_ATTEMPTS`). Any other
	 * filesystem error (permissions, read-only filesystem, …) is fatal — the
	 * lock is the whole contract here, so the caller should exit rather than
	 * start unguarded.
	 */
	acquire(): AcquireOutcome {
		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			try {
				fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });
				// O_EXCL create; the package records the lock so it is unlinked if
				// this process exits without calling `release`.
				lockfile.lockSync(this.lockPath);
				this.held = true;
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== "EEXIST") {
					return { kind: "error", message: errorMessage(error) };
				}

				const inspected = this.inspectExisting();
				if (inspected.kind === "held") return inspected;
				if (inspected.kind === "error") return inspected;
				// inspected.kind === "steal": the stale/dead lockfile is gone (or
				// already gone by the time we tried); loop around and retry.
				continue;
			}

			// The create and the pid write are two steps; a concurrent starter
			// that reads the file in between sees it empty and, being younger
			// than WRITE_IN_PROGRESS_MS, treats it as "being written" (see
			// `inspectExisting`) rather than as garbage to steal.
			try {
				fs.writeFileSync(this.lockPath, `${process.pid}\n`);
				return { kind: "ok" };
			} catch (error) {
				this.release();
				return { kind: "error", message: errorMessage(error) };
			}
		}
		return {
			kind: "error",
			message: `${this.lockPath}: could not acquire after ${MAX_ATTEMPTS} attempts`,
		};
	}

	/**
	 * Look at the lockfile that made `acquire`'s create fail, and decide
	 * whether it is genuinely held, or safe to steal (unlink) so the caller
	 * can retry the create.
	 */
	private inspectExisting():
		{ kind: "held"; pid: number } | { kind: "error"; message: string } | { kind: "steal" } {
		let content: string;
		let mtimeMs: number;
		try {
			content = fs.readFileSync(this.lockPath, "utf8");
			mtimeMs = fs.statSync(this.lockPath).mtimeMs;
		} catch (error) {
			// The lockfile disappeared between the failed create and this read
			// (another process released or stole it): safe to retry the create.
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "steal" };
			return { kind: "error", message: errorMessage(error) };
		}

		// Strict: `parseInt` would read "1x" as pid 1 (launchd, always alive)
		// and "-1" as a signal to every process, so only a bare positive
		// integer counts as a pid.
		const pid = parseLockPid(content);
		if (pid !== undefined) {
			if (isAlive(pid)) return { kind: "held", pid };
			return this.unlinkAndSteal();
		}

		// Unparsable/empty content: another starter may still be mid-write
		// (create-then-write is not atomic). A young file gets the benefit of
		// the doubt; an old one is stale garbage safe to steal.
		if (Date.now() - mtimeMs < WRITE_IN_PROGRESS_MS) {
			return { kind: "error", message: `${this.lockPath} is being written; retry` };
		}
		return this.unlinkAndSteal();
	}

	private unlinkAndSteal(): { kind: "error"; message: string } | { kind: "steal" } {
		try {
			// Best-effort unlink; an already-gone file is a no-op for the package.
			lockfile.unlockSync(this.lockPath);
		} catch (error) {
			return { kind: "error", message: errorMessage(error) };
		}
		return { kind: "steal" };
	}

	/**
	 * Release the lock, if this instance is the one holding it. Idempotent:
	 * a second call (or a call on an instance that never acquired) is a
	 * no-op. Never throws — this runs on shutdown, where a failure here must
	 * not stop the rest of teardown.
	 */
	release(): void {
		if (!this.held) return;
		this.held = false;
		try {
			const content = fs.readFileSync(this.lockPath, "utf8");
			if (parseLockPid(content) === process.pid) lockfile.unlockSync(this.lockPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			console.error(`mdxserve: failed to release lock ${this.lockPath}: ${errorMessage(error)}`);
		}
	}
}
