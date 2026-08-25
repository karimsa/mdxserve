import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter, type AppRouter } from "../../src/api/router.js";
import type { ApiContext } from "../../src/api/trpc.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext as buildContext } from "../helpers/context.js";

let fixtureDir: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-api-router-test-")),
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

// Compile-time canary: if a procedure key is renamed or dropped from
// appRouter, this fails to typecheck rather than silently losing coverage.
const procedureKeys: Array<keyof AppRouter["_def"]["procedures"]> = [
	"getFolderListing",
	"getDocTree",
	"searchDocs",
	"moveDocsToTrash",
	"validateDoc",
	"getDocSource",
	"saveDocSection",
	"listComponents",
	"getComponent",
];

describe("procedure descriptions", () => {
	it("every procedure has a well-formed meta.description", () => {
		const procedures = appRouter._def.procedures as Record<
			string,
			{ meta?: { description?: string } }
		>;
		const names = Object.keys(procedures);
		expect(names.length).toBeGreaterThan(0);
		expect(names.sort()).toEqual([...procedureKeys].sort());
		for (const name of names) {
			const description = procedures[name].meta?.description;
			expect(description, `${name} description`).toBeTypeOf("string");
			expect(description!.length, `${name} description length`).toBeGreaterThanOrEqual(20);
			expect(description![0], `${name} description starts with a capital`).toBe(
				description![0].toUpperCase(),
			);
			expect(description!.endsWith("."), `${name} description ends with a period`).toBe(true);
		}
	});
});

describe("same-origin guard", () => {
	it("rejects mutations from a mismatched Origin with FORBIDDEN, but not queries", async () => {
		const crossOrigin = makeContext({ origin: "http://evil.example", host: "127.0.0.1:4040" });
		await expect(
			createCaller(crossOrigin).validateDoc({ path: path.join(fixtureDir, "good.md") }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		const tree = await createCaller(crossOrigin).getDocTree({});
		expect(tree.roots).toHaveLength(1);
	});

	it("accepts a matching Origin, an absent Origin, and rejects an unparsable one", async () => {
		const good = path.join(fixtureDir, "good.md");
		const matching = makeContext({ origin: "http://127.0.0.1:4040", host: "127.0.0.1:4040" });
		expect((await createCaller(matching).validateDoc({ path: good })).ok).toBe(true);
		const absent = makeContext({ host: "127.0.0.1:4040" });
		expect((await createCaller(absent).validateDoc({ path: good })).ok).toBe(true);
		const opaque = makeContext({ origin: "null", host: "127.0.0.1:4040" });
		await expect(createCaller(opaque).validateDoc({ path: good })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});
});
