import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { registerServer, unregisterServer, liveServers } from "../src/server-registry.js";
import sqlite from "node-sqlite3-wasm";

let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-registry-test-"));
	dbPath = path.join(tmpDir, "servers.db");
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

describe("registerServer / unregisterServer / liveServers", () => {
	it("registers a server and finds it via liveServers", () => {
		registerServer({ port: 5001, pid: process.pid, host: "127.0.0.1", roots: ["/a"] }, dbPath);
		const servers = liveServers(dbPath);
		expect(servers).toHaveLength(1);
		expect(servers[0]).toMatchObject({
			port: 5001,
			pid: process.pid,
			host: "127.0.0.1",
			roots: ["/a"],
		});
		expect(typeof servers[0].startedAt).toBe("number");
	});

	it("unregisterServer removes the row", () => {
		registerServer({ port: 5002, pid: process.pid, host: "127.0.0.1", roots: ["/a"] }, dbPath);
		expect(liveServers(dbPath).map((s) => s.port)).toContain(5002);
		unregisterServer(5002, dbPath);
		expect(liveServers(dbPath).map((s) => s.port)).not.toContain(5002);
	});

	it("registering the same port twice replaces the row", () => {
		registerServer({ port: 5003, pid: process.pid, host: "127.0.0.1", roots: ["/a"] }, dbPath);
		registerServer({ port: 5003, pid: process.pid, host: "0.0.0.0", roots: ["/b", "/c"] }, dbPath);
		const servers = liveServers(dbPath);
		const matching = servers.filter((s) => s.port === 5003);
		expect(matching).toHaveLength(1);
		expect(matching[0]).toMatchObject({ host: "0.0.0.0", roots: ["/b", "/c"] });
	});

	it("prunes a row whose pid has died, and it stays gone", () => {
		// A process that starts and exits immediately: its pid is guaranteed
		// dead by the time we get here.
		const result = spawnSync(process.execPath, ["-e", ""]);
		const deadPid = result.pid;
		expect(deadPid).toBeGreaterThan(0);

		registerServer({ port: 5004, pid: deadPid, host: "127.0.0.1", roots: ["/a"] }, dbPath);
		expect(liveServers(dbPath).map((s) => s.port)).not.toContain(5004);
		// The prune is a side effect of the first call; confirm it stuck.
		expect(liveServers(dbPath).map((s) => s.port)).not.toContain(5004);
	});
});

describe("liveServers (property)", () => {
	const portArb = fc.integer({ min: 1024, max: 65535 });
	const portsAndSubsetArb = fc
		.uniqueArray(portArb, { minLength: 0, maxLength: 20 })
		.chain((ports) => fc.tuple(fc.constant(ports), fc.subarray(ports)));

	it("returns exactly the registered ports, and unregistering a subset leaves exactly the rest", () => {
		let counter = 0;
		fc.assert(
			fc.property(portsAndSubsetArb, ([ports, toUnregister]) => {
				// Each run gets its own db file so concurrent fast-check runs never
				// see each other's rows.
				const propDb = path.join(tmpDir, `prop-${counter++}.db`);

				for (const port of ports) {
					registerServer({ port, pid: process.pid, host: "127.0.0.1", roots: [] }, propDb);
				}

				const registered = new Set(liveServers(propDb).map((s) => s.port));
				expect(registered).toEqual(new Set(ports));

				for (const port of toUnregister) {
					unregisterServer(port, propDb);
				}

				const remaining = new Set(liveServers(propDb).map((s) => s.port));
				const expected = new Set(ports.filter((p) => !toUnregister.includes(p)));
				expect(remaining).toEqual(expected);
			}),
			{ numRuns: 25 },
		);
	});

	it("skips a malformed row without hiding the healthy servers", () => {
		registerServer({ port: 5601, pid: process.pid, host: "127.0.0.1", roots: ["/a"] }, dbPath);
		const db = new sqlite.Database(dbPath);
		try {
			db.run("INSERT INTO servers (port, pid, host, roots, started_at) VALUES (?, ?, ?, ?, ?)", [
				5602,
				process.pid,
				"127.0.0.1",
				"not json",
				0,
			]);
		} finally {
			db.close();
		}
		expect(liveServers(dbPath).map((s) => s.port)).toEqual([5601]);
	});
});
