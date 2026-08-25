import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { ServerLock, parseLockPid } from "../../src/servers/server-lock.js";

let tmpDir: string;
let lockPath: string;

beforeAll(async () => {
	tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "mdxserve-lock-test-"));
});

afterEach(async () => {
	await fsp.rm(lockPath, { force: true });
});

afterAll(async () => {
	await fsp.rm(tmpDir, { recursive: true, force: true });
});

/** A pid guaranteed dead by the time the caller uses it. */
function deadPid(): number {
	const result = spawnSync(process.execPath, ["-e", ""]);
	const pid = result.pid;
	if (!pid || pid <= 0) throw new Error("failed to spawn a throwaway process");
	return pid;
}

describe("ServerLock", () => {
	it("acquires a fresh lockfile and writes our own pid", () => {
		lockPath = path.join(tmpDir, "fresh.lock");
		const lock = new ServerLock(lockPath);
		expect(lock.acquire()).toEqual({ kind: "ok" });
		expect(fs.readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
	});

	it("a second ServerLock on the same path reports held with our pid", () => {
		lockPath = path.join(tmpDir, "held.lock");
		const first = new ServerLock(lockPath);
		expect(first.acquire()).toEqual({ kind: "ok" });
		const second = new ServerLock(lockPath);
		expect(second.acquire()).toEqual({ kind: "held", pid: process.pid });
	});

	it("steals a lockfile written by a dead pid", () => {
		lockPath = path.join(tmpDir, "dead.lock");
		fs.mkdirSync(path.dirname(lockPath), { recursive: true });
		fs.writeFileSync(lockPath, `${deadPid()}\n`);
		const lock = new ServerLock(lockPath);
		expect(lock.acquire()).toEqual({ kind: "ok" });
		expect(fs.readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
	});

	it("never steals a live pid's lock because of its age (no mtime-based staleness)", () => {
		// The `lockfile` package can expire locks by mtime when given `stale`;
		// we deliberately don't, so a server that has been up for hours (and
		// never touches its lockfile) still holds it.
		lockPath = path.join(tmpDir, "old-but-alive.lock");
		fs.writeFileSync(lockPath, `${process.pid}\n`);
		const old = new Date(Date.now() - 60_000);
		fs.utimesSync(lockPath, old, old);
		expect(new ServerLock(lockPath).acquire()).toEqual({ kind: "held", pid: process.pid });
		expect(fs.readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
	});

	it("treats a pid with trailing junk, a negative pid, or pid 0 as garbage, never as a live pid", () => {
		// parseInt would read "1x" as pid 1 (launchd, always alive) and "-1" as
		// "every process"; both must be classed as unparsable and stolen.
		for (const content of ["1x", "-1", "0", " 1 2 "]) {
			lockPath = path.join(tmpDir, "junk.lock");
			fs.writeFileSync(lockPath, content);
			const old = new Date(Date.now() - 10_000);
			fs.utimesSync(lockPath, old, old);
			expect(new ServerLock(lockPath).acquire()).toEqual({ kind: "ok" });
			fs.rmSync(lockPath, { force: true });
		}
		expect(parseLockPid(" 42\n")).toBe(42);
		expect(parseLockPid("1x")).toBeUndefined();
		expect(parseLockPid("-1")).toBeUndefined();
		expect(parseLockPid("0")).toBeUndefined();
	});

	it("steals garbage content once it is old enough not to be mid-write", () => {
		lockPath = path.join(tmpDir, "garbage-old.lock");
		fs.writeFileSync(lockPath, "not a pid");
		const old = new Date(Date.now() - 10_000);
		fs.utimesSync(lockPath, old, old);
		const lock = new ServerLock(lockPath);
		expect(lock.acquire()).toEqual({ kind: "ok" });
	});

	it("refuses to steal garbage content that is still fresh (a starter mid-write)", () => {
		lockPath = path.join(tmpDir, "garbage-fresh.lock");
		fs.writeFileSync(lockPath, "not a pid");
		const lock = new ServerLock(lockPath);
		const outcome = lock.acquire();
		expect(outcome.kind).toBe("error");
	});

	it("release removes the file", () => {
		lockPath = path.join(tmpDir, "release.lock");
		const lock = new ServerLock(lockPath);
		expect(lock.acquire()).toEqual({ kind: "ok" });
		lock.release();
		expect(fs.existsSync(lockPath)).toBe(false);
	});

	it("release is idempotent", () => {
		lockPath = path.join(tmpDir, "release-twice.lock");
		const lock = new ServerLock(lockPath);
		expect(lock.acquire()).toEqual({ kind: "ok" });
		lock.release();
		expect(() => lock.release()).not.toThrow();
		expect(fs.existsSync(lockPath)).toBe(false);
	});

	it("release leaves a lockfile that now holds a foreign pid untouched", () => {
		lockPath = path.join(tmpDir, "release-foreign.lock");
		const lock = new ServerLock(lockPath);
		expect(lock.acquire()).toEqual({ kind: "ok" });
		// Someone else took over the file after we acquired it.
		fs.writeFileSync(lockPath, "999999999\n");
		lock.release();
		expect(fs.readFileSync(lockPath, "utf8").trim()).toBe("999999999");
	});

	it("creates the parent directory when it does not exist", () => {
		lockPath = path.join(tmpDir, "nested", "dir", "fresh.lock");
		const lock = new ServerLock(lockPath);
		expect(lock.acquire()).toEqual({ kind: "ok" });
		expect(fs.existsSync(lockPath)).toBe(true);
	});

	it("reports an error when the parent directory is unwritable", () => {
		if (process.getuid && process.getuid() === 0) return; // root ignores permission bits
		const unwritableDir = path.join(tmpDir, "unwritable");
		fs.mkdirSync(unwritableDir, { recursive: true });
		fs.chmodSync(unwritableDir, 0o500);
		lockPath = path.join(unwritableDir, "fresh.lock");
		try {
			const lock = new ServerLock(lockPath);
			const outcome = lock.acquire();
			expect(outcome.kind).toBe("error");
		} finally {
			fs.chmodSync(unwritableDir, 0o700);
		}
	});
});

describe("ServerLock (property)", () => {
	const CONCURRENT_INSTANCES = 4;

	it("at most one instance holds the lock at a time, and the file exists iff someone holds it", () => {
		let counter = 0;
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						holder: fc.nat({ max: CONCURRENT_INSTANCES - 1 }),
						op: fc.constantFrom<"acquire" | "release">("acquire", "release"),
					}),
					{ minLength: 0, maxLength: 40 },
				),
				(steps) => {
					const propLockPath = path.join(tmpDir, `prop-${counter++}.lock`);
					const instances = Array.from(
						{ length: CONCURRENT_INSTANCES },
						() => new ServerLock(propLockPath),
					);
					const acquiredNotReleased = new Set<number>();

					for (const step of steps) {
						const instance = instances[step.holder];
						if (step.op === "acquire") {
							const outcome = instance.acquire();
							if (outcome.kind === "ok") acquiredNotReleased.add(step.holder);
						} else {
							instance.release();
							acquiredNotReleased.delete(step.holder);
						}

						expect(acquiredNotReleased.size).toBeLessThanOrEqual(1);
						expect(fs.existsSync(propLockPath)).toBe(acquiredNotReleased.size === 1);
					}

					for (const instance of instances) instance.release();
					fs.rmSync(propLockPath, { force: true });
				},
			),
			{ numRuns: 30 },
		);
	});

	it("acquire succeeds on any stale content with an old mtime", () => {
		const deadPids = [deadPid(), deadPid(), deadPid()];
		const staleContentArb = fc.oneof(
			fc.constantFrom(...deadPids.map((pid) => String(pid))),
			fc.string().filter((value) => !/^\d+$/.test(value.trim())),
			fc.constant(""),
		);
		let counter = 0;
		fc.assert(
			fc.property(staleContentArb, (content) => {
				const propLockPath = path.join(tmpDir, `stale-${counter++}.lock`);
				fs.writeFileSync(propLockPath, content);
				const old = new Date(Date.now() - 10_000);
				fs.utimesSync(propLockPath, old, old);

				const lock = new ServerLock(propLockPath);
				expect(lock.acquire()).toEqual({ kind: "ok" });

				lock.release();
				fs.rmSync(propLockPath, { force: true });
			}),
			{ numRuns: 20 },
		);
	});
});
