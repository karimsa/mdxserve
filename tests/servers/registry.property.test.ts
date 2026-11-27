import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { ServerRegistry } from "../../src/servers/server-registry.js";

// 25 fresh sqlite files per property; the CI runner has taken >5 s.
const PROPERTY_TIMEOUT_MS = 30000;

let tmpDir: string;

beforeAll(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdxserve-registry-property-"));
});

afterAll(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

let counter = 0;
function freshDbPath(label: string): string {
	return path.join(tmpDir, `${label}-${counter++}.db`);
}

/** A pid guaranteed dead by the time the caller uses it. */
function deadPid(): number {
	const result = spawnSync(process.execPath, ["-e", ""]);
	const pid = result.pid;
	if (!pid || pid <= 0) throw new Error("failed to spawn a throwaway process");
	return pid;
}

const recordShape = {
	port: fc.integer({ min: 1, max: 65535 }),
	host: fc.string(),
	roots: fc.array(fc.string()),
};
const recordArb = fc.record(recordShape);

describe("ServerRegistry (property)", () => {
	it(
		"register -> current round-trips an arbitrary record",
		() => {
			fc.assert(
				fc.property(recordArb, (record) => {
					const propRegistry = new ServerRegistry(freshDbPath("roundtrip"));
					propRegistry.register({ ...record, pid: process.pid });
					expect(propRegistry.current()).toMatchObject({ ...record, pid: process.pid });
				}),
				{ numRuns: 25 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"updateRoots is idempotent",
		() => {
			fc.assert(
				fc.property(recordArb, fc.array(fc.string()), (record, newRoots) => {
					const propRegistry = new ServerRegistry(freshDbPath("idempotent"));
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
		},
		PROPERTY_TIMEOUT_MS,
	);

	type Model = { pid: number; port: number; host: string; roots: string[] } | undefined;

	const opArb = fc.oneof(
		fc.record({ kind: fc.constant("register" as const), ...recordShape }),
		fc.record({ kind: fc.constant("registerDead" as const), ...recordShape }),
		fc.record({ kind: fc.constant("updateRoots" as const), roots: fc.array(fc.string()) }),
		fc.constant({ kind: "unregister" as const }),
		fc.constant({ kind: "legacyLockDir" as const }),
	);

	it(
		"any sequence of writes, dead servers and stale legacy lock directories matches a tiny model, without waits or warnings",
		() => {
			// One dead pid for the whole run: spawning per step would dominate it.
			const dead = deadPid();
			fc.assert(
				fc.property(fc.array(opArb, { minLength: 0, maxLength: 30 }), (ops) => {
					const dbPath = freshDbPath("model");
					const propRegistry = new ServerRegistry(dbPath);
					const warnings: string[] = [];
					const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
						warnings.push(args.map(String).join(" "));
					});
					let model: Model;

					try {
						for (const op of ops) {
							if (op.kind === "register" || op.kind === "registerDead") {
								const pid = op.kind === "register" ? process.pid : dead;
								propRegistry.register({ port: op.port, pid, host: op.host, roots: op.roots });
								// A dead server's row is never visible.
								model =
									op.kind === "register"
										? { pid, port: op.port, host: op.host, roots: op.roots }
										: undefined;
							} else if (op.kind === "updateRoots") {
								propRegistry.updateRoots(process.pid, op.roots);
								if (model) model = { ...model, roots: op.roots };
							} else if (op.kind === "unregister") {
								propRegistry.unregister(process.pid);
								model = undefined;
							} else {
								fs.mkdirSync(`${dbPath}.lock`, { recursive: true });
							}

							const started = performance.now();
							const current = propRegistry.current();
							expect(performance.now() - started).toBeLessThan(500);
							if (model === undefined) {
								expect(current).toBeUndefined();
							} else {
								expect(current).toMatchObject(model);
							}
						}
					} finally {
						spy.mockRestore();
					}
					expect(warnings).toEqual([]);
				}),
				{ numRuns: 25 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});
