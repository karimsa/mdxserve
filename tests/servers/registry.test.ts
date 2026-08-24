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

describe("ServerRegistry", () => {
	it("registers a server and finds it via live()", () => {
		registry.register({ port: 5001, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
		const servers = registry.live();
		expect(servers).toHaveLength(1);
		expect(servers[0]).toMatchObject({
			port: 5001,
			pid: process.pid,
			host: "127.0.0.1",
			roots: ["/a"],
		});
		expect(typeof servers[0].startedAt).toBe("number");
	});

	it("unregister removes the row", () => {
		registry.register({ port: 5002, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
		expect(registry.live().map((server) => server.port)).toContain(5002);
		registry.unregister(5002);
		expect(registry.live().map((server) => server.port)).not.toContain(5002);
	});

	it("registering the same port twice replaces the row", () => {
		registry.register({ port: 5003, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
		registry.register({ port: 5003, pid: process.pid, host: "0.0.0.0", roots: ["/b", "/c"] });
		const servers = registry.live();
		const matching = servers.filter((server) => server.port === 5003);
		expect(matching).toHaveLength(1);
		expect(matching[0]).toMatchObject({ host: "0.0.0.0", roots: ["/b", "/c"] });
	});

	it("prunes a row whose pid has died, and it stays gone", () => {
		// A process that starts and exits immediately: its pid is guaranteed
		// dead by the time we get here.
		const result = spawnSync(process.execPath, ["-e", ""]);
		const deadPid = result.pid;
		expect(deadPid).toBeGreaterThan(0);

		registry.register({ port: 5004, pid: deadPid, host: "127.0.0.1", roots: ["/a"] });
		expect(registry.live().map((server) => server.port)).not.toContain(5004);
		// The prune is a side effect of the first call; confirm it stuck.
		expect(registry.live().map((server) => server.port)).not.toContain(5004);
	});
});

describe("ServerRegistry#live (property)", () => {
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
				const propRegistry = new ServerRegistry(path.join(tmpDir, `prop-${counter++}.db`));

				for (const port of ports) {
					propRegistry.register({ port, pid: process.pid, host: "127.0.0.1", roots: [] });
				}

				const registered = new Set(propRegistry.live().map((server) => server.port));
				expect(registered).toEqual(new Set(ports));

				for (const port of toUnregister) {
					propRegistry.unregister(port);
				}

				const remaining = new Set(propRegistry.live().map((server) => server.port));
				const expected = new Set(ports.filter((port) => !toUnregister.includes(port)));
				expect(remaining).toEqual(expected);
			}),
			{ numRuns: 25 },
		);
	});

	it("skips a malformed row without hiding the healthy servers", () => {
		registry.register({ port: 5601, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
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
		expect(registry.live().map((server) => server.port)).toEqual([5601]);
	});
});
