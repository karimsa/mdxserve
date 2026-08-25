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
const absDirArb = fc
	.array(segmentArb, { minLength: 1, maxLength: 3 })
	.map((segments) => `/${segments.join("/")}`);

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

describe("RootsService.reconcile guarantees", () => {
	it("is idempotent, keeps only outermost roots, and never invents one", () => {
		fc.assert(
			fc.property(fc.array(absDirArb, { maxLength: 6 }), (roots) => {
				const service = new RootsService("/");
				const reconciled = service.reconcile(roots);
				const dirs = reconciled.map((rootInfo) => rootInfo.dir);

				for (const dir of dirs) expect(roots).toContain(dir);
				expect(new Set(dirs).size).toBe(dirs.length);
				for (const outer of dirs) {
					for (const inner of dirs) {
						if (outer === inner) continue;
						expect(isInside(outer, inner)).toBe(false);
					}
				}
				expect(service.reconcile(dirs)).toEqual(reconciled);
			}),
		);
	});

	it("keeps every root that nothing else contains", () => {
		fc.assert(
			fc.property(fc.array(absDirArb, { maxLength: 6 }), (roots) => {
				const dirs = new Set(
					new RootsService("/").reconcile(roots).map((rootInfo) => rootInfo.dir),
				);
				for (const root of roots) {
					const contained = roots.some((other) => other !== root && isInside(other, root));
					if (!contained) expect(dirs.has(root)).toBe(true);
				}
			}),
		);
	});
});
