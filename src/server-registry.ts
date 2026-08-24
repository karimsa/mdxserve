import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// WASM build of SQLite: no native module, so `yarn install` needs no build
// scripts and the same binary runs on every node version the launcher pins.
import sqlite from "node-sqlite3-wasm";

const { Database } = sqlite;
type Database = InstanceType<typeof Database>;

export interface ServerRecord {
	port: number;
	pid: number;
	host: string;
	roots: string[];
	startedAt: number;
}

/**
 * `~/.mdxserve/servers.db`, or `$MDXSERVE_HOME/servers.db` when `MDXSERVE_HOME`
 * is set (used by tests to point at a scratch directory instead of the real
 * home directory).
 */
export function defaultRegistryPath(): string {
	const dir = process.env.MDXSERVE_HOME || path.join(os.homedir(), ".mdxserve");
	return path.join(dir, "servers.db");
}

function warn(action: string, dbPath: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	// stderr only: this must never crash `serve`, and in `mdxserve mcp` (stdio
	// transport) stdout is reserved for the protocol.
	console.error(`mdxserve: failed to ${action} ${dbPath}: ${message}`);
}

function openDb(dbPath: string): Database {
	fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	const db = new Database(dbPath);
	// Rows are tiny and written rarely (server start/stop), so a short busy
	// timeout is enough for two servers starting at the same moment.
	db.exec("PRAGMA busy_timeout = 2000");
	db.exec(`
		CREATE TABLE IF NOT EXISTS servers (
			port INTEGER PRIMARY KEY,
			pid INTEGER NOT NULL,
			host TEXT NOT NULL,
			roots TEXT NOT NULL,
			started_at INTEGER NOT NULL
		)
	`);
	return db;
}

/** Register (or replace, on port collision) a running server. */
export function registerServer(
	rec: Omit<ServerRecord, "startedAt">,
	dbPath = defaultRegistryPath(),
): void {
	try {
		const db = openDb(dbPath);
		try {
			db.run(
				`INSERT OR REPLACE INTO servers (port, pid, host, roots, started_at) VALUES (?, ?, ?, ?, ?)`,
				[rec.port, rec.pid, rec.host, JSON.stringify(rec.roots), Date.now()],
			);
		} finally {
			db.close();
		}
	} catch (error) {
		warn("register server in", dbPath, error);
	}
}

export function unregisterServer(port: number, dbPath = defaultRegistryPath()): void {
	try {
		const db = openDb(dbPath);
		try {
			db.run(`DELETE FROM servers WHERE port = ?`, [port]);
		} finally {
			db.close();
		}
	} catch (error) {
		warn("unregister server in", dbPath, error);
	}
}

/** Whether a process with this pid is still alive (EPERM still counts as alive: it exists, just owned by someone else). */
function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

interface ServerRow {
	port: number;
	pid: number;
	host: string;
	roots: string;
	started_at: number;
}

/**
 * Every registered server whose pid is still alive, ordered by start time.
 * Rows whose pid has died are pruned from the db as a side effect (a crashed
 * server never gets to call `unregisterServer` itself).
 */
export function liveServers(dbPath = defaultRegistryPath()): ServerRecord[] {
	try {
		const db = openDb(dbPath);
		try {
			const rows = db.all(
				`SELECT port, pid, host, roots, started_at FROM servers ORDER BY started_at ASC`,
			) as unknown as ServerRow[];

			const live: ServerRecord[] = [];
			const dead: number[] = [];
			for (const row of rows) {
				if (!isAlive(row.pid)) {
					dead.push(row.port);
					continue;
				}
				// One malformed row must not hide the healthy servers around it.
				let roots: string[];
				try {
					roots = JSON.parse(row.roots) as string[];
					if (!Array.isArray(roots)) throw new Error("roots is not an array");
				} catch (error) {
					warn(`parse roots for port ${row.port} in`, dbPath, error);
					continue;
				}
				live.push({
					port: row.port,
					pid: row.pid,
					host: row.host,
					roots,
					startedAt: row.started_at,
				});
			}

			// Pruning is housekeeping: if it fails, the stale rows just get
			// another chance next time — the live list is still correct.
			if (dead.length > 0) {
				try {
					db.exec("BEGIN");
					try {
						for (const port of dead) db.run(`DELETE FROM servers WHERE port = ?`, [port]);
						db.exec("COMMIT");
					} catch (error) {
						db.exec("ROLLBACK");
						throw error;
					}
				} catch (error) {
					warn("prune dead servers from", dbPath, error);
				}
			}

			return live;
		} finally {
			db.close();
		}
	} catch (error) {
		warn("read server registry at", dbPath, error);
		return [];
	}
}
