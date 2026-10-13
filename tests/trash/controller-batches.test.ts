import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import { moveDocsToTrashResultSchema } from "../../src/trash/controller.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext } from "../helpers/context.js";

const trashed: string[] = [];
let recoveryDir: string;
vi.mock("trash", () => ({
	default: async (absPath: string) => {
		trashed.push(absPath);
		await fs.rename(absPath, path.join(recoveryDir, path.basename(absPath)));
	},
}));

const createCaller = createCallerFactory(appRouter);
const PROPERTY_TIMEOUT_MS = 30000;

type Target =
	| { kind: "doc"; name: string }
	| { kind: "dir"; name: string }
	| { kind: "dotfile"; name: string }
	| { kind: "non-doc"; name: string }
	| { kind: "missing"; name: string }
	| { kind: "outside"; name: string };

const letter = fc.constantFrom("a", "b", "c", "d");

const targetArb: fc.Arbitrary<Target> = fc.oneof(
	letter.map((name): Target => ({ kind: "doc", name: `${name}.md` })),
	letter.map((name): Target => ({ kind: "dir", name: `dir-${name}` })),
	letter.map((name): Target => ({ kind: "dotfile", name: `.${name}.md` })),
	letter.map((name): Target => ({ kind: "non-doc", name: `${name}.txt` })),
	letter.map((name): Target => ({ kind: "missing", name: `missing-${name}.md` })),
	letter.map((name): Target => ({ kind: "outside", name: `${name}.md` })),
);

const targetsArb = fc
	.array(targetArb, { minLength: 1, maxLength: 6 })
	.map((targets) => {
		const seen = new Set<string>();
		return targets.filter((target) => {
			const key = `${target.kind === "outside" ? "outside" : "inside"}:${target.name}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	})
	.filter((targets) => targets.length > 0);

async function withTargets(
	targets: Target[],
	body: (root: string, paths: string[], deletable: Set<string>) => Promise<void>,
): Promise<void> {
	const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-trash-prop-")));
	const outside = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-trash-prop-outside-")),
	);
	recoveryDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-trash-prop-recovery-"));
	try {
		const paths: string[] = [];
		const deletable = new Set<string>();
		for (const target of targets) {
			if (target.kind === "outside") {
				const abs = path.join(outside, target.name);
				await fs.writeFile(abs, "# Outside\n", "utf8");
				paths.push(abs);
				continue;
			}
			const abs = path.join(root, target.name);
			if (target.kind === "doc") {
				await fs.writeFile(abs, "# Doc\n", "utf8");
				deletable.add(abs);
			} else if (target.kind === "dir") {
				await fs.mkdir(abs);
			} else if (target.kind === "dotfile") {
				await fs.writeFile(abs, "# Dot\n", "utf8");
			} else if (target.kind === "non-doc") {
				await fs.writeFile(abs, "Keep this text.\n", "utf8");
			}
			paths.push(abs);
		}
		await body(root, paths, deletable);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
		await fs.rm(outside, { recursive: true, force: true });
		await fs.rm(recoveryDir, { recursive: true, force: true });
	}
}

describe("moveDocsToTrash properties", () => {
	it(
		"every input path lands in exactly one of deleted or failed, in the order it was given",
		async () => {
			await fc.assert(
				fc.asyncProperty(targetsArb, async (targets) => {
					await withTargets(targets, async (root, paths) => {
						trashed.length = 0;
						const caller = createCaller(makeContext(root, registry));
						const result = await caller.moveDocsToTrash({ paths });

						expect(moveDocsToTrashResultSchema.parse(result)).toEqual(result);

						const failedPaths = result.failed.map((failure) => failure.path);
						expect([...result.deleted, ...failedPaths].sort()).toEqual([...paths].sort());
						expect(new Set([...result.deleted, ...failedPaths]).size).toBe(paths.length);

						const reported = paths.filter(
							(candidate) => result.deleted.includes(candidate) || failedPaths.includes(candidate),
						);
						expect(reported).toEqual(paths);
					});
				}),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"exactly the servable docs inside a root are trashed; nothing else is even attempted",
		async () => {
			await fc.assert(
				fc.asyncProperty(targetsArb, async (targets) => {
					await withTargets(targets, async (root, paths, deletable) => {
						trashed.length = 0;
						const caller = createCaller(makeContext(root, registry));
						const result = await caller.moveDocsToTrash({ paths });

						expect([...result.deleted].sort()).toEqual([...deletable].sort());
						expect([...trashed].sort()).toEqual([...deletable].sort());
						for (const moved of deletable) {
							expect(await fs.readFile(path.join(recoveryDir, path.basename(moved)), "utf8")).toBe(
								"# Doc\n",
							);
						}
						for (const failure of result.failed) {
							expect(deletable.has(failure.path)).toBe(false);
							expect(failure.error.length).toBeGreaterThan(0);
						}
					});
				}),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"re-running a batch is a no-op: everything already trashed now fails as Not found",
		async () => {
			await fc.assert(
				fc.asyncProperty(targetsArb, async (targets) => {
					await withTargets(targets, async (root, paths, deletable) => {
						trashed.length = 0;
						const caller = createCaller(makeContext(root, registry));
						await caller.moveDocsToTrash({ paths });
						trashed.length = 0;

						const again = await caller.moveDocsToTrash({ paths });
						expect(again.deleted).toEqual([]);
						expect(trashed).toEqual([]);
						for (const alreadyGone of deletable) {
							expect(again.failed).toContainEqual({ path: alreadyGone, error: "Not found" });
						}
					});
				}),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});
