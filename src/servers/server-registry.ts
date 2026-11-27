import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// A native SQLite build, so locking uses the OS's file locks. The kernel drops
// them when a process dies, even under SIGKILL, so a killed process leaves
// nothing behind for the next one to wait on.
import Database from "better-sqlite3";

export interface ServerRecord {
	port: number;
	pid: number;
	host: string;
	roots: string[];
	startedAt: number;
}

/**
 * `~/.mdxserve`, or `$MDXSERVE_HOME` when set (used by tests, and by anything
 * that wants to point the lockfile and registry at a scratch directory
 * instead of the real home directory).
 */
export function mdxserveHome(): string {
	return process.env.MDXSERVE_HOME || path.join(os.homedir(), ".mdxserve");
}

/** `<mdxserveHome>/servers.db` — despite the name, holds the single running server's row. */
function defaultRegistryPath(): string {
	return path.join(mdxserveHome(), "servers.db");
}

function warn(action: string, dbPath: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	// stderr only: this must never crash `serve`, and in the CLI stdout is
	// reserved for output such as `--json`.
	console.error(`mdxserve: failed to ${action} ${dbPath}: ${message}`);
}

/**
 * The better-sqlite3 prebuilds target Node-API 10 (Node 22.14 and newer). An
 * older node crashes while loading the addon instead of throwing, so refuse
 * first and let the caller carry on without the registry.
 */
function assertNodeApiSupported(): void {
	if (Number(process.versions.napi) < 10) {
		throw new Error(
			`the server registry needs Node.js 22.14 or newer (this is ${process.version})`,
		);
	}
}

/**
 * Releases before better-sqlite3 used a WASM SQLite that locked by creating a
 * `servers.db.lock` directory, which a killed process could leave behind.
 * SQLite no longer looks at it, so remove it when it is empty to keep it from
 * suggesting otherwise. rmdir refuses a missing or non-empty directory, and
 * either is fine to leave alone.
 */
function removeLegacyLockDir(dbPath: string): void {
	try {
		fs.rmdirSync(`${dbPath}.lock`);
	} catch {
		// Missing, not empty, or not ours to remove.
	}
}

function openDb(dbPath: string): Database.Database {
	assertNodeApiSupported();
	fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	removeLegacyLockDir(dbPath);
	// Default rollback journal. The row is tiny and written rarely (server
	// start, and whenever roots change), and a lock is held only by a live
	// process for the length of one statement. The busy timeout covers a
	// starter racing the still-shutting-down previous instance; nobody waits
	// on it when no live process holds the lock.
	const db = new Database(dbPath, { timeout: 2000 });
	// Legacy multi-server table from the fan-out era: nothing in it is worth
	// migrating (a dead process's row is meaningless, and a live one will
	// re-register itself as the single row below on its next write).
	db.exec("DROP TABLE IF EXISTS servers");
	db.exec(`
		CREATE TABLE IF NOT EXISTS server (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			pid INTEGER NOT NULL,
			port INTEGER NOT NULL,
			host TEXT NOT NULL,
			roots TEXT NOT NULL,
			started_at INTEGER NOT NULL
		)
	`);
	return db;
}

/** Whether a process with this pid is still alive (EPERM still counts as alive: it exists, just owned by someone else). */
export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

interface ServerRow {
	pid: number;
	port: number;
	host: string;
	roots: string;
	started_at: number;
}

/**
 * The single `mdxserve serve` instance currently running on this machine,
 * backed by a sqlite db at `dbPath` holding exactly one row (id = 1). The CLI
 * reads this row to find the running server; the server itself keeps it
 * current as its roots change.
 */
export class ServerRegistry {
	constructor(private readonly dbPath: string = defaultRegistryPath()) {}

	/** Register (or replace) the running server's row. */
	register(record: Omit<ServerRecord, "startedAt">): void {
		try {
			const db = openDb(this.dbPath);
			try {
				db.prepare(
					`INSERT OR REPLACE INTO server (id, pid, port, host, roots, started_at) VALUES (1, ?, ?, ?, ?, ?)`,
				).run(record.pid, record.port, record.host, JSON.stringify(record.roots), Date.now());
			} finally {
				db.close();
			}
		} catch (error) {
			warn("register server in", this.dbPath, error);
		}
	}

	/** Update the roots on the current row, only when it still belongs to `pid`. */
	updateRoots(pid: number, roots: string[]): void {
		try {
			const db = openDb(this.dbPath);
			try {
				db.prepare(`UPDATE server SET roots = ? WHERE id = 1 AND pid = ?`).run(
					JSON.stringify(roots),
					pid,
				);
			} finally {
				db.close();
			}
		} catch (error) {
			warn("update roots in", this.dbPath, error);
		}
	}

	/**
	 * Remove the row, only when it still belongs to `pid` — a guard against a
	 * slow-exiting old process clobbering its own replacement's row on the
	 * way out.
	 */
	unregister(pid: number): void {
		try {
			const db = openDb(this.dbPath);
			try {
				db.prepare(`DELETE FROM server WHERE id = 1 AND pid = ?`).run(pid);
			} finally {
				db.close();
			}
		} catch (error) {
			warn("unregister server in", this.dbPath, error);
		}
	}

	/**
	 * The running server's row, or `undefined` if none is registered or its
	 * pid has died. A dead row is pruned as a side effect (a crashed server
	 * never gets to call `unregister` itself). A malformed `roots` column
	 * doesn't hide the rest of the row — pid/port/host still matter to a
	 * caller like `mdxserve status` — so it comes back as `roots: []` instead.
	 */
	current(): ServerRecord | undefined {
		try {
			const db = openDb(this.dbPath);
			try {
				const row = db
					.prepare(`SELECT pid, port, host, roots, started_at FROM server WHERE id = 1`)
					.get() as ServerRow | undefined;
				if (!row) return undefined;

				if (!isAlive(row.pid)) {
					// Delete only the row judged dead. A replacement server may have
					// registered since the SELECT, and its row must survive.
					try {
						db.prepare(`DELETE FROM server WHERE id = 1 AND pid = ? AND started_at = ?`).run(
							row.pid,
							row.started_at,
						);
					} catch (error) {
						warn("prune dead server from", this.dbPath, error);
					}
					return undefined;
				}

				let roots: string[];
				try {
					roots = JSON.parse(row.roots) as string[];
					if (!Array.isArray(roots)) throw new Error("roots is not an array");
				} catch (error) {
					warn(`parse roots for pid ${row.pid} in`, this.dbPath, error);
					roots = [];
				}

				return { pid: row.pid, port: row.port, host: row.host, roots, startedAt: row.started_at };
			} finally {
				db.close();
			}
		} catch (error) {
			warn("read server registry at", this.dbPath, error);
			return undefined;
		}
	}
}
