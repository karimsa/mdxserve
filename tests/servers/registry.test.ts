import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { ServerRegistry } from "../../src/servers/server-registry.js";

const registryModule = path.resolve(import.meta.dirname, "../../src/servers/server-registry.ts");

let tmpDir: string;
let dbPath: string;
let registry: ServerRegistry;

beforeAll(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-registry-test-"));
	dbPath = path.join(tmpDir, "servers.db");
	registry = new ServerRegistry(dbPath);
});

afterEach(async () => {
	vi.restoreAllMocks();
	// Fresh db per test: delete the file (and anything an older release left
	// next to it) so tests don't see each other's rows.
	for (const suffix of ["", "-journal", "-wal", "-shm"]) {
		await fs.rm(dbPath + suffix, { force: true });
	}
	await fs.rm(`${dbPath}.lock`, { recursive: true, force: true });
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

function withDb<Result>(dbFile: string, use: (db: Database.Database) => Result): Result {
	const db = new Database(dbFile);
	try {
		return use(db);
	} finally {
		db.close();
	}
}

function rowCount(dbFile: string): number {
	return withDb(
		dbFile,
		(db) => (db.prepare("SELECT COUNT(*) AS count FROM server").get() as { count: number }).count,
	);
}

/** Every warning the registry printed while `run` ran, and how long it took. */
function observe<Result>(run: () => Result): { result: Result; warnings: string[]; ms: number } {
	const warnings: string[] = [];
	const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
		warnings.push(args.map(String).join(" "));
	});
	const started = performance.now();
	try {
		const result = run();
		return { result, warnings, ms: performance.now() - started };
	} finally {
		spy.mockRestore();
	}
}

/**
 * A child process that loads the registry module and runs `body` with
 * `registry` (a ServerRegistry on `file`) in scope. It prints "ready" first.
 */
function spawnRegistryChild(file: string, body: string) {
	const script = `
		import { ServerRegistry } from ${JSON.stringify(registryModule)};
		const registry = new ServerRegistry(${JSON.stringify(file)});
		process.stdout.write("ready\\n");
		${body}
	`;
	const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
	child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
	const ready = new Promise<void>((resolve, reject) => {
		child.stdout.on("data", () => {
			if (stdout.includes("ready")) resolve();
		});
		child.on("exit", () => reject(new Error(`child exited before it was ready: ${stderr}`)));
	});
	const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
		child.on("exit", (code, signal) => resolve({ code, signal })),
	);
	return {
		child,
		ready,
		exited,
		output: () => ({ stdout, stderr }),
	};
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

	it("the prune leaves alone a server that registered after the dead row was read", () => {
		const pid = deadPid();
		registry.register({ port: 5010, pid, host: "127.0.0.1", roots: ["/old"] });

		// current() reads the dead row, then asks whether its pid is alive. A
		// replacement server registers in that gap, before the prune runs.
		const replacement = new ServerRegistry(dbPath);
		const realKill = process.kill.bind(process);
		vi.spyOn(process, "kill").mockImplementation((target, signal) => {
			if (target === pid && signal === 0) {
				replacement.register({ port: 5011, pid: process.pid, host: "127.0.0.1", roots: ["/new"] });
			}
			return realKill(target, signal);
		});

		const { result, warnings } = observe(() => registry.current());
		expect(result).toBeUndefined();
		expect(warnings).toEqual([]);
		vi.restoreAllMocks();
		expect(registry.current()).toMatchObject({ port: 5011, pid: process.pid, roots: ["/new"] });
	});

	it("malformed roots JSON comes back as roots: [], keeping pid/port/host", () => {
		registry.register({ port: 5009, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
		withDb(dbPath, (db) => db.prepare("UPDATE server SET roots = ? WHERE id = 1").run("not json"));
		expect(registry.current()).toMatchObject({ port: 5009, pid: process.pid, roots: [] });
	});

	it("migrates away from a legacy `servers` table on first open", async () => {
		const legacyDbPath = path.join(tmpDir, "legacy.db");
		withDb(legacyDbPath, (db) => {
			db.exec(`
				CREATE TABLE servers (
					port INTEGER PRIMARY KEY,
					pid INTEGER NOT NULL,
					host TEXT NOT NULL,
					roots TEXT NOT NULL,
					started_at INTEGER NOT NULL
				)
			`);
			db.prepare(
				"INSERT INTO servers (port, pid, host, roots, started_at) VALUES (?, ?, ?, ?, ?)",
			).run(4000, process.pid, "127.0.0.1", "[]", 0);
		});

		const legacyRegistry = new ServerRegistry(legacyDbPath);
		expect(legacyRegistry.current()).toBeUndefined();

		const names = withDb(legacyDbPath, (db) =>
			(
				db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
					name: string;
				}[]
			).map((table) => table.name),
		);
		expect(names).toContain("server");
		expect(names).not.toContain("servers");

		await fs.rm(legacyDbPath, { force: true });
	});
});

// Releases that used node-sqlite3-wasm locked the db by creating
// `servers.db.lock`; a process killed inside a statement left it behind, and
// every later command waited out the busy timeout and failed.
describe("ServerRegistry with a lock directory an older release left behind", () => {
	it("reads without waiting or warning, and removes the empty directory once it is old", async () => {
		registry.register({ port: 5101, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
		await fs.mkdir(`${dbPath}.lock`);
		const longAgo = new Date(Date.now() - 10 * 60_000);
		await fs.utimes(`${dbPath}.lock`, longAgo, longAgo);

		const { result, warnings, ms } = observe(() => registry.current());
		expect(result).toMatchObject({ port: 5101, roots: ["/a"] });
		expect(warnings).toEqual([]);
		expect(ms).toBeLessThan(500);
		expect(existsSync(`${dbPath}.lock`)).toBe(false);
	});

	// A still-running older release holds an empty directory just as briefly as
	// any statement; removing it would drop that release's own exclusion.
	it("leaves a freshly created lock directory in place, and still reads at once", async () => {
		registry.register({ port: 5104, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
		await fs.mkdir(`${dbPath}.lock`);

		const { result, warnings, ms } = observe(() => registry.current());
		expect(result).toMatchObject({ port: 5104 });
		expect(warnings).toEqual([]);
		expect(ms).toBeLessThan(500);
		expect(existsSync(`${dbPath}.lock`)).toBe(true);
	});

	it("writes without waiting or warning", async () => {
		await fs.mkdir(path.dirname(dbPath), { recursive: true });
		await fs.mkdir(`${dbPath}.lock`);

		const { warnings, ms } = observe(() => {
			registry.register({ port: 5102, pid: process.pid, host: "127.0.0.1", roots: ["/a"] });
			registry.updateRoots(process.pid, ["/b"]);
		});
		expect(warnings).toEqual([]);
		expect(ms).toBeLessThan(500);
		expect(registry.current()).toMatchObject({ port: 5102, roots: ["/b"] });
	});

	it("is not blocked by a lock directory that is not empty, and leaves it in place", async () => {
		await fs.mkdir(`${dbPath}.lock`, { recursive: true });
		await fs.writeFile(path.join(`${dbPath}.lock`, "keep"), "");

		const { warnings, ms } = observe(() => {
			registry.register({ port: 5103, pid: process.pid, host: "127.0.0.1", roots: [] });
			return registry.current();
		});
		expect(warnings).toEqual([]);
		expect(ms).toBeLessThan(500);
		expect(registry.current()).toMatchObject({ port: 5103 });
		expect(existsSync(path.join(`${dbPath}.lock`, "keep"))).toBe(true);
	});
});

describe("ServerRegistry across processes", () => {
	it("two processes writing at once both succeed", async () => {
		const shared = path.join(tmpDir, "concurrent.db");
		const loop = (port: number) => `
			const deadline = Date.now() + 1500;
			let writes = 0;
			while (Date.now() < deadline) {
				registry.register({ port: ${port}, pid: process.pid, host: "127.0.0.1", roots: ["/r" + writes] });
				registry.updateRoots(process.pid, ["/u" + writes]);
				registry.current();
				writes++;
			}
			process.stdout.write("writes " + writes + "\\n");
		`;
		const first = spawnRegistryChild(shared, loop(6001));
		const second = spawnRegistryChild(shared, loop(6002));
		const [firstExit, secondExit] = await Promise.all([first.exited, second.exited]);

		for (const [exit, child] of [
			[firstExit, first],
			[secondExit, second],
		] as const) {
			expect(exit).toEqual({ code: 0, signal: null });
			expect(child.output().stderr).toBe("");
			expect(child.output().stdout).toMatch(/writes [1-9]\d*/);
		}
		expect(rowCount(shared)).toBe(1);
	}, 30_000);

	it("a writer SIGKILLed mid-write leaves a registry the next caller reads at once", async () => {
		const shared = path.join(tmpDir, "killed.db");
		for (let attempt = 0; attempt < 5; attempt++) {
			const writer = spawnRegistryChild(
				shared,
				`
				for (let writes = 0; ; writes++) {
					registry.register({ port: 7000, pid: process.pid, host: "127.0.0.1", roots: ["/" + writes] });
					registry.updateRoots(process.pid, ["/u" + writes]);
				}
				`,
			);
			await writer.ready;
			await new Promise((resolve) => setTimeout(resolve, attempt * 7));
			writer.child.kill("SIGKILL");
			await writer.exited;

			const reader = new ServerRegistry(shared);
			const { result, warnings, ms } = observe(() => reader.current());
			expect(warnings).toEqual([]);
			expect(ms).toBeLessThan(500);
			// The writer is dead, so its row is pruned.
			expect(result).toBeUndefined();
		}
	}, 60_000);
});
