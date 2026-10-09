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

it("rejects invalid startup config and releases the server lock", async () => {
	await fs.writeFile(path.join(tmpDir, "config.json"), '{"roots":42}');
	const outcome = await startServer({ roots: [], port: 0, host: "127.0.0.1" });
	expect(outcome.kind).toBe("error");
	const lock = new ServerLock(defaultLockPath());
	try {
		expect(lock.acquire()).toEqual({ kind: "ok" });
	} finally {
		lock.release();
	}
	expect(await fs.readFile(path.join(tmpDir, "config.json"), "utf8")).toBe('{"roots":42}');
});

it.each(["0.0.0.0", "::", "192.168.1.10", "docs.local"])(
	"rejects explicit full permissions on %s before changing saved roots or taking the lock",
	async (host) => {
		const configPath = path.join(tmpDir, "config.json");
		const content = JSON.stringify({ roots: ["private"] });
		await fs.writeFile(configPath, content);
		const outcome = await startServer({ roots: ["public"], port: 0, host, permissions: "full" });
		expect(outcome).toEqual({
			kind: "error",
			message: expect.stringContaining("--dangerous-allow-network"),
		});
		expect(await fs.readFile(configPath, "utf8")).toBe(content);
		expect(await fs.readdir(tmpDir)).toEqual(["config.json"]);
	},
);

it("allows explicit full permissions on the network only with the dangerous opt-in", async () => {
	const lock = new ServerLock(defaultLockPath());
	expect(lock.acquire()).toEqual({ kind: "ok" });
	try {
		const outcome = await startServer({
			roots: [],
			port: 0,
			host: "0.0.0.0",
			permissions: "full",
			dangerousAllowNetwork: true,
		});
		expect(outcome.kind).toBe("already-running");
	} finally {
		lock.release();
	}
});

it("defaults network binding to restricted and requires one explicit root before taking the lock", async () => {
	for (const roots of [[], ["one", "two"]]) {
		const outcome = await startServer({ roots, port: 0, host: "0.0.0.0" });
		expect(outcome).toEqual({
			kind: "error",
			message: "restricted permissions require exactly one explicit -w directory",
		});
	}
	const lock = new ServerLock(defaultLockPath());
	try {
		expect(lock.acquire()).toEqual({ kind: "ok" });
	} finally {
		lock.release();
	}
});

it("does not promote a network bind to full permissions with the dangerous flag alone", async () => {
	const outcome = await startServer({
		roots: [],
		port: 0,
		host: "0.0.0.0",
		dangerousAllowNetwork: true,
	});
	expect(outcome).toEqual({
		kind: "error",
		message: "restricted permissions require exactly one explicit -w directory",
	});
});

it("rejects an invalid permissions mode before taking the lock", async () => {
	const outcome = await startServer({
		roots: [],
		port: 0,
		host: "127.0.0.1",
		permissions: "sandbox",
	});
	expect(outcome).toEqual({
		kind: "error",
		message: expect.stringContaining("invalid permissions mode"),
	});
	const lock = new ServerLock(defaultLockPath());
	try {
		expect(lock.acquire()).toEqual({ kind: "ok" });
	} finally {
		lock.release();
	}
});

it("refuses to reuse an existing server when restricted permissions are requested", async () => {
	const lock = new ServerLock(defaultLockPath());
	expect(lock.acquire()).toEqual({ kind: "ok" });
	try {
		const outcome = await startServer({
			roots: [tmpDir],
			port: 0,
			host: "0.0.0.0",
			permissions: "restricted",
		});
		expect(outcome).toEqual({
			kind: "error",
			message: expect.stringContaining("cannot reuse an existing mdxserve server"),
		});
	} finally {
		lock.release();
	}
});
