import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { RootsService } from "../../src/roots/service.js";
import { isInside } from "../../src/roots/root-info.js";

const PROPERTY_TIMEOUT_MS = 30000;

/** Absolute-looking directory paths, some of which nest inside each other. */
const segmentArb = fc.constantFrom("alpha", "beta", "gamma");

/** A directory layout under one temp root: names, some nested. */
const layoutArb = fc.uniqueArray(
	fc.array(segmentArb, { minLength: 1, maxLength: 2 }).map((segments) => segments.join("/")),
	{ minLength: 1, maxLength: 4, selector: (relative) => relative },
);

async function withLayout(
	relatives: string[],
	body: (base: string, absolutes: string[]) => Promise<void>,
): Promise<void> {
	const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-roots-prop-")));
	try {
		const absolutes: string[] = [];
		for (const relative of relatives) {
			const abs = path.join(base, relative);
			await fs.mkdir(abs, { recursive: true });
			absolutes.push(abs);
		}
		await body(base, absolutes);
	} finally {
		await fs.rm(base, { recursive: true, force: true });
	}
}

describe("RootsService.admit guarantees", () => {
	it(
		"an ok admission never contains a duplicate or a root nested inside another",
		async () => {
			await fc.assert(
				fc.asyncProperty(layoutArb, async (relatives) => {
					await withLayout(relatives, async (_base, absolutes) => {
						const result = await new RootsService(process.cwd()).admit(absolutes);
						if (result.kind !== "ok") return;
						expect(new Set(result.roots).size).toBe(result.roots.length);
						for (const outer of result.roots) {
							for (const inner of result.roots) {
								if (outer === inner) continue;
								expect(isInside(outer, inner)).toBe(false);
							}
						}
					});
				}),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"the verdict does not depend on the order the roots were named in",
		async () => {
			await fc.assert(
				fc.asyncProperty(layoutArb, async (relatives) => {
					await withLayout(relatives, async (_base, absolutes) => {
						const service = new RootsService(process.cwd());
						const forwards = await service.admit(absolutes);
						const backwards = await service.admit([...absolutes].reverse());
						expect(backwards.kind).toBe(forwards.kind);
						if (forwards.kind === "ok" && backwards.kind === "ok") {
							expect([...backwards.roots].sort()).toEqual([...forwards.roots].sort());
						}
					});
				}),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"repeating a root any number of times admits exactly the same set as naming it once",
		async () => {
			await fc.assert(
				fc.asyncProperty(layoutArb, fc.integer({ min: 1, max: 3 }), async (relatives, copies) => {
					await withLayout(relatives, async (_base, absolutes) => {
						const service = new RootsService(process.cwd());
						const once = await service.admit(absolutes);
						const repeated = await service.admit(
							absolutes.flatMap((abs) => Array.from({ length: copies }, () => abs)),
						);
						expect(repeated.kind).toBe(once.kind);
						if (once.kind === "ok" && repeated.kind === "ok") {
							expect(repeated.roots).toEqual(once.roots);
						}
					});
				}),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"every admitted root has a rootInfo, and the display names are unique",
		async () => {
			await fc.assert(
				fc.asyncProperty(layoutArb, async (relatives) => {
					await withLayout(relatives, async (_base, absolutes) => {
						const result = await new RootsService(process.cwd()).admit(absolutes);
						if (result.kind !== "ok") return;
						expect(result.rootInfos.map((rootInfo) => rootInfo.dir)).toEqual(result.roots);
						const names = result.rootInfos.map((rootInfo) => rootInfo.name);
						expect(new Set(names).size).toBe(names.length);
					});
				}),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});

type Command = { kind: "add" | "remove"; dirs: string[] };

/** A sequence of add/remove commands, each naming a non-empty subset of the layout's dirs. */
function commandsArb(absolutes: string[]): fc.Arbitrary<Command[]> {
	return fc.array(
		fc.record({
			kind: fc.constantFrom<"add" | "remove">("add", "remove"),
			dirs: fc.subarray(absolutes, { minLength: 1 }),
		}),
		{ minLength: 1, maxLength: 6 },
	);
}

/** A plain-Set reference model of the mounted set, applying the same rules RootsService does. */
function applyToModel(mounted: Set<string>, command: Command): boolean {
	if (command.kind === "remove") {
		if (!command.dirs.every((dir) => mounted.has(dir))) return false;
		for (const dir of command.dirs) mounted.delete(dir);
		return true;
	}

	const added = command.dirs.filter((dir) => !mounted.has(dir));
	const union = [...mounted, ...added];
	for (const outer of union) {
		for (const inner of union) {
			if (outer === inner) continue;
			if (isInside(outer, inner)) return false;
		}
	}
	for (const dir of added) mounted.add(dir);
	return true;
}

function assertInvariants(rootInfos: { name: string; dir: string }[]): void {
	const dirs = rootInfos.map((info) => info.dir);
	expect(new Set(dirs).size).toBe(dirs.length);
	for (const outer of dirs) {
		for (const inner of dirs) {
			if (outer === inner) continue;
			expect(isInside(outer, inner)).toBe(false);
		}
	}
	const names = rootInfos.map((info) => info.name);
	expect(new Set(names).size).toBe(names.length);
}

describe("RootsService mounted-set guarantees", () => {
	it(
		"after every add/remove step, list() matches a Set<string> reference model and stays invariant-clean",
		async () => {
			await fc.assert(
				fc.asyncProperty(layoutArb, async (relatives) => {
					await withLayout(relatives, async (_base, absolutes) => {
						await fc.assert(
							fc.asyncProperty(commandsArb(absolutes), async (commands) => {
								const service = new RootsService(process.cwd());
								const model = new Set<string>();
								for (const command of commands) {
									const modelOk = applyToModel(model, command);
									const result =
										command.kind === "add"
											? await service.add(command.dirs)
											: await service.remove(command.dirs);
									expect(result.kind === "ok").toBe(modelOk);

									const rootInfos = service.list();
									assertInvariants(rootInfos);
									expect(new Set(rootInfos.map((info) => info.dir))).toEqual(model);
								}
							}),
							{ numRuns: 10 },
						);
					});
				}),
				{ numRuns: 5 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"running the same batch of commands concurrently still leaves list() invariant-clean",
		async () => {
			await fc.assert(
				fc.asyncProperty(layoutArb, async (relatives) => {
					await withLayout(relatives, async (_base, absolutes) => {
						await fc.assert(
							fc.asyncProperty(commandsArb(absolutes), async (commands) => {
								const service = new RootsService(process.cwd());
								// Order between concurrent add/remove calls is not defined, so
								// this only checks the invariants hold no matter how the
								// service's internal queue happened to interleave them — not
								// that the outcome matches any particular reference model.
								await Promise.all(
									commands.map((command) =>
										command.kind === "add"
											? service.add(command.dirs)
											: service.remove(command.dirs),
									),
								);
								assertInvariants(service.list());
							}),
							{ numRuns: 10 },
						);
					});
				}),
				{ numRuns: 5 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"the listener fires exactly once per ok result with a non-empty delta",
		async () => {
			await fc.assert(
				fc.asyncProperty(layoutArb, async (relatives) => {
					await withLayout(relatives, async (_base, absolutes) => {
						await fc.assert(
							fc.asyncProperty(commandsArb(absolutes), async (commands) => {
								const service = new RootsService(process.cwd());
								let notifications = 0;
								service.onChange(() => {
									notifications += 1;
								});

								let expectedNotifications = 0;
								for (const command of commands) {
									if (command.kind === "add") {
										const result = await service.add(command.dirs);
										if (result.kind === "ok" && result.added.length > 0) {
											expectedNotifications += 1;
										}
									} else {
										const result = await service.remove(command.dirs);
										if (result.kind === "ok" && result.removed.length > 0) {
											expectedNotifications += 1;
										}
									}
								}

								expect(notifications).toBe(expectedNotifications);
							}),
							{ numRuns: 10 },
						);
					});
				}),
				{ numRuns: 5 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});
