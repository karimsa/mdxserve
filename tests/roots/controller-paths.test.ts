import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import { RootsService } from "../../src/roots/service.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext as buildContext } from "../helpers/context.js";

let fixtureDir: string;
let missingBase: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-roots-controller-prop-")),
	);
	// Never created — every path under it is guaranteed to not exist.
	missingBase = path.join(fixtureDir, "does-not-exist");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
});

const createCaller = createCallerFactory(appRouter);

const segmentArb = fc
	.string({ minLength: 1, maxLength: 12 })
	.filter(
		(segment) =>
			!segment.includes("/") && !segment.includes("\0") && segment !== "." && segment !== "..",
	);

const missingAbsPathArb = fc
	.array(segmentArb, { minLength: 1, maxLength: 4 })
	.map((segments) => path.join(missingBase, ...segments));

const relativeStringArb = fc
	.array(segmentArb, { minLength: 1, maxLength: 4 })
	.map((segments) => segments.join("/"))
	.filter((value) => value.length > 0 && !path.isAbsolute(value));

describe("addRoots missing paths", () => {
	it("a random absolute path under a directory that doesn't exist is always NOT_FOUND", async () => {
		await fc.assert(
			fc.asyncProperty(missingAbsPathArb, async (absent) => {
				const roots = new RootsService(fixtureDir, os.homedir(), []);
				const context = buildContext(fixtureDir, registry, {
					roots,
					rootInfos: roots.list(),
					isLoopback: true,
				});
				await expect(createCaller(context).addRoots({ dirs: [absent] })).rejects.toMatchObject({
					code: "NOT_FOUND",
				});
				expect(roots.list()).toEqual([]);
			}),
			{ numRuns: 20 },
		);
	});
});

describe("addRoots/removeRoots relative paths", () => {
	it("a relative dirs entry is rejected by the schema before RootsService sees it", async () => {
		await fc.assert(
			fc.asyncProperty(relativeStringArb, async (relative) => {
				const roots = new RootsService(fixtureDir, os.homedir(), [fixtureDir]);
				const before = roots.list();
				const context = buildContext(fixtureDir, registry, {
					roots,
					rootInfos: roots.list(),
					isLoopback: true,
				});
				await expect(createCaller(context).addRoots({ dirs: [relative] })).rejects.toMatchObject({
					code: "BAD_REQUEST",
				});
				await expect(createCaller(context).removeRoots({ dirs: [relative] })).rejects.toMatchObject(
					{ code: "BAD_REQUEST" },
				);
				expect(roots.list()).toEqual(before);
			}),
			{ numRuns: 20 },
		);
	});
});
