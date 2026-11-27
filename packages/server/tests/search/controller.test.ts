import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import type { ApiContext } from "../../src/api/trpc.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext as buildContext } from "../helpers/context.js";

let fixtureDir: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-search-controller-test-")),
	);
	await fs.writeFile(
		path.join(fixtureDir, "good.md"),
		"# Good doc\n\nSome plain GFM content about widgets and gadgets.\n",
		"utf8",
	);
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
});

function makeContext(overrides: Partial<ApiContext> = {}): ApiContext {
	return buildContext(fixtureDir, registry, overrides);
}

const createCaller = createCallerFactory(appRouter);

describe("searchDocs", () => {
	it("finds a fixture word and every result has a numeric score", async () => {
		const caller = createCaller(makeContext());
		const result = await caller.searchDocs({ query: "widgets" });
		expect(result.results.length).toBeGreaterThan(0);
		for (const entry of result.results) {
			expect(entry.score).toBeTypeOf("number");
		}
		expect(result.results.map((hit) => hit.path)).toContain(path.join(fixtureDir, "good.md"));
	});
});
