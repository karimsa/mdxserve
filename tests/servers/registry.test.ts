import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { ServerRegistry } from "../../src/servers/server-registry.js";
import sqlite from "node-sqlite3-wasm";

let tmpDir: string;
let dbPath: string;
let registry: ServerRegistry;

beforeAll(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-registry-test-"));
	dbPath = path.join(tmpDir, "servers.db");
	registry = new ServerRegistry(dbPath);
});

afterEach(async () => {
	// Fresh db per test: delete the file (and any journal siblings) so tests
	// don't see each other's rows.
	for (const suffix of ["", "-wal", "-shm"]) {
		await fs.rm(dbPath + suffix, { force: true });
	}
});

afterAll(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

/** A pid guaranteed dead by the time the caller uses it. */
function deadPid(): number {
	const result = spawnSync(process.execPath, ["-e", ""]);
	const pid = result.pid;
	if (!pid || pid <= 0) throw new Error("failed to spawn a throwaway process");
	return pid;
}

function rowCount(dbFile: string): number {
	const db = new sqlite.Database(dbFile);
	try {
		const rows = db.all("SELECT COUNT(*) as count FROM server") as unknown as { count: number }[];
		return rows[0]?.count ?? 0;
	} finally {
		db.close();
	}
}

describe("ServerRegistry", () => {
	it("registers a server and finds it via current()", () => {
		registry.register({ port: 5001, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
		const current = registry.current();
		expect(current).toMatchObject({
			port: 5001,
			pid: process.pid,
			host: "127.0.0.1",
			roots: ["/a"],
		});
		expect(typeof current?.startedAt).toBe("number");
	});

	it("registering twice replaces the row: current() is the second, and only one row exists", () => {
		registry.register({ port: 5002, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
		registry.register({ port: 5003, pid: process.pid, host: "0.0.0.0", roots: ["/b", "/c"] });
		expect(registry.current()).toMatchObject({ port: 5003, host: "0.0.0.0", roots: ["/b", "/c"] });
		expect(rowCount(dbPath)).toBe(1);
	});

	it("updateRoots with the current owner's pid is visible on current()", () => {
		registry.register({ port: 5004, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
		registry.updateRoots(process.pid, ["/a", "/b"]);
		expect(registry.current()).toMatchObject({ roots: ["/a", "/b"] });
	});

	it("updateRoots with a foreign pid is ignored", () => {
		registry.register({ port: 5005, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
		registry.updateRoots(process.pid + 1, ["/somewhere-else"]);
		expect(registry.current()).toMatchObject({ roots: ["/a"] });
	});

	it("unregister with a foreign pid is ignored", () => {
		registry.register({ port: 5006, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
		registry.unregister(process.pid + 1);
		expect(registry.current()).toMatchObject({ port: 5006 });
	});

	it("unregister with the owning pid clears the row", () => {
		registry.register({ port: 5007, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
		registry.unregister(process.pid);
		expect(registry.current()).toBeUndefined();
	});

	it("a dead pid's row is pruned: current() is undefined, and it stays gone", () => {
		const pid = deadPid();
		registry.register({ port: 5008, pid, host: "127.0.0.1", roots: ["/a"] });
		expect(registry.current()).toBeUndefined();
		// The prune is a side effect of the first call; confirm it stuck.
		expect(registry.current()).toBeUndefined();
		expect(rowCount(dbPath)).toBe(0);
	});

	it("malformed roots JSON comes back as roots: [], keeping pid/port/host", () => {
		registry.register({ port: 5009, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
		const db = new sqlite.Database(dbPath);
		try {
			db.run("UPDATE server SET roots = ? WHERE id = 1", ["not json"]);
		} finally {
			db.close();
		}
		expect(registry.current()).toMatchObject({ port: 5009, pid: process.pid, roots: [] });
	});

	it("migrates away from a legacy `servers` table on first open", async () => {
		const legacyDbPath = path.join(tmpDir, "legacy.db");
		const db = new sqlite.Database(legacyDbPath);
		try {
			db.exec(`
				CREATE TABLE servers (
					port INTEGER PRIMARY KEY,
					pid INTEGER NOT NULL,
					host TEXT NOT NULL,
					roots TEXT NOT NULL,
					started_at INTEGER NOT NULL
				)
			`);
			db.run("INSERT INTO servers (port, pid, host, roots, started_at) VALUES (?, ?, ?, ?, ?)", [
				4000,
				process.pid,
				"127.0.0.1",
				"[]",
				0,
			]);
		} finally {
			db.close();
		}

		const legacyRegistry = new ServerRegistry(legacyDbPath);
		expect(legacyRegistry.current()).toBeUndefined();

		const verifyDb = new sqlite.Database(legacyDbPath);
		try {
			const tables = verifyDb.all(
				"SELECT name FROM sqlite_master WHERE type = 'table'",
			) as unknown as { name: string }[];
			const names = tables.map((table) => table.name);
			expect(names).toContain("server");
			expect(names).not.toContain("servers");
		} finally {
			verifyDb.close();
		}

		await fs.rm(legacyDbPath, { force: true });
	});
});

describe("ServerRegistry (property)", () => {
	const recordShape = {
		port: fc.integer({ min: 1, max: 65535 }),
		host: fc.string(),
		roots: fc.array(fc.string()),
	};
	const recordArb = fc.record(recordShape);

	it("register -> current round-trips an arbitrary record", () => {
		let counter = 0;
		fc.assert(
			fc.property(recordArb, (record) => {
				const propRegistry = new ServerRegistry(path.join(tmpDir, `prop-${counter++}.db`));
				propRegistry.register({ ...record, pid: process.pid });
				expect(propRegistry.current()).toMatchObject({ ...record, pid: process.pid });
			}),
			{ numRuns: 25 },
		);
	});

	it("updateRoots is idempotent", () => {
		let counter = 0;
		fc.assert(
			fc.property(recordArb, fc.array(fc.string()), (record, newRoots) => {
				const propRegistry = new ServerRegistry(path.join(tmpDir, `prop-idem-${counter++}.db`));
				propRegistry.register({ ...record, pid: process.pid });
				propRegistry.updateRoots(process.pid, newRoots);
				const once = propRegistry.current();
				propRegistry.updateRoots(process.pid, newRoots);
				const twice = propRegistry.current();
				expect(once).toEqual(twice);
				expect(once?.roots).toEqual(newRoots);
			}),
			{ numRuns: 25 },
		);
	});

	type Model = { pid: number; port: number; host: string; roots: string[] } | undefined;

	const opArb = fc.oneof(
		fc.record({ kind: fc.constant("register" as const), ...recordShape }),
		fc.record({ kind: fc.constant("updateRoots" as const), roots: fc.array(fc.string()) }),
		fc.constant({ kind: "unregister" as const }),
	);

	it("a random sequence of register/updateRoots/unregister matches a tiny in-memory model", () => {
		let counter = 0;
		fc.assert(
			fc.property(fc.array(opArb, { minLength: 0, maxLength: 30 }), (ops) => {
				const propRegistry = new ServerRegistry(path.join(tmpDir, `prop-model-${counter++}.db`));
				let model: Model;

				for (const op of ops) {
					if (op.kind === "register") {
						propRegistry.register({
							port: op.port,
							pid: process.pid,
							host: op.host,
							roots: op.roots,
						});
						model = { pid: process.pid, port: op.port, host: op.host, roots: op.roots };
					} else if (op.kind === "updateRoots") {
						propRegistry.updateRoots(process.pid, op.roots);
						if (model) model = { ...model, roots: op.roots };
					} else {
						propRegistry.unregister(process.pid);
						model = undefined;
					}

					const current = propRegistry.current();
					if (model === undefined) {
						expect(current).toBeUndefined();
					} else {
						expect(current).toMatchObject(model);
					}
				}
			}),
			{ numRuns: 25 },
		);
	});
});
