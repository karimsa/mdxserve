import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer } from "../../src/http/start.js";
import { ServerLock, defaultLockPath } from "../../src/servers/server-lock.js";
import { ServerRegistry } from "../../src/servers/server-registry.js";

let tmpDir: string;
let previousHome: string | undefined;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-start-test-"));
	previousHome = process.env.MDXSERVE_HOME;
	process.env.MDXSERVE_HOME = tmpDir;
});

afterEach(async () => {
	if (previousHome === undefined) delete process.env.MDXSERVE_HOME;
	else process.env.MDXSERVE_HOME = previousHome;
	await fs.rm(tmpDir, { recursive: true, force: true });
});

// startServer takes the server lock before loadRegistry() (which needs
// dist/registry.json), so an "already running" outcome must be reachable
// without a build — this suite proves that by holding the lock ourselves
// first, the same way a second `mdxserve serve` invocation would find it
// held.
describe("startServer (lock held by another process)", () => {
	it("reports already-running without port/host when no registry row exists yet", async () => {
		const lock = new ServerLock(defaultLockPath());
		expect(lock.acquire()).toEqual({ kind: "ok" });
		try {
			const outcome = await startServer({ roots: [], port: 0, host: "127.0.0.1" });
			expect(outcome).toEqual({
				kind: "already-running",
				pid: process.pid,
				port: undefined,
				host: undefined,
			});
		} finally {
			lock.release();
		}
	});

	it("reports the registered port/host once the row exists", async () => {
		const lock = new ServerLock(defaultLockPath());
		expect(lock.acquire()).toEqual({ kind: "ok" });
		const registry = new ServerRegistry();
		registry.register({ pid: process.pid, port: 5050, host: "127.0.0.1", roots: [] });
		try {
			const outcome = await startServer({ roots: [], port: 0, host: "127.0.0.1" });
			expect(outcome).toEqual({
				kind: "already-running",
				pid: process.pid,
				port: 5050,
				host: "127.0.0.1",
			});
		} finally {
			registry.unregister(process.pid);
			lock.release();
		}
	});
});
