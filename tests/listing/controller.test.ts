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
let outsideDir: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-listing-controller-test-")),
	);
	outsideDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-listing-controller-outside-")),
	);

	await fs.writeFile(
		path.join(fixtureDir, "good.md"),
		"# Good doc\n\nSome plain GFM content about widgets and gadgets.\n",
		"utf8",
	);
	await fs.mkdir(path.join(fixtureDir, "sub"));
	await fs.writeFile(
		path.join(fixtureDir, "sub", "nested.md"),
		"# Nested\n\nNested content.\n",
		"utf8",
	);
	await fs.mkdir(path.join(fixtureDir, "sub", "subsub"));
	await fs.writeFile(
		path.join(fixtureDir, "sub", "subsub", "deep.md"),
		"# Deep\n\nDeep content.\n",
		"utf8",
	);
	await fs.writeFile(path.join(outsideDir, "secret.md"), "# Secret\n", "utf8");
	// A directory inside the root that's really a symlink pointing outside it.
	await fs.symlink(outsideDir, path.join(fixtureDir, "escape"), "dir");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
	await fs.rm(outsideDir, { recursive: true, force: true });
});

function makeContext(overrides: Partial<ApiContext> = {}): ApiContext {
	return buildContext(fixtureDir, registry, overrides);
}

const createCaller = createCallerFactory(appRouter);

describe("getFolderListing", () => {
	it("lists a directory's entries", async () => {
		const caller = createCaller(makeContext());
		const result = await caller.getFolderListing({ path: fixtureDir });
		expect(result.rootName).toBe("docs");
		expect(result.rootDir).toBe(fixtureDir);
		expect(result.entries.map((entry) => entry.name).sort()).toEqual(
			["escape", "good.md", "sub"].sort(),
		);
		expect(result).not.toHaveProperty("kind");
	});

	it("throws NOT_FOUND for a path outside every root", async () => {
		const caller = createCaller(makeContext());
		await expect(caller.getFolderListing({ path: outsideDir })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("throws NOT_FOUND for a file path", async () => {
		const caller = createCaller(makeContext());
		await expect(
			caller.getFolderListing({ path: path.join(fixtureDir, "good.md") }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("getDocTree", () => {
	it("with no path, returns one entry per rootInfo", async () => {
		const caller = createCaller(
			makeContext({
				rootInfos: [
					{ name: "docs", dir: fixtureDir },
					{ name: "other", dir: outsideDir },
				],
			}),
		);
		const result = await caller.getDocTree({});
		expect(result.roots.map((root) => root.name).sort()).toEqual(["docs", "other"].sort());
	});

	it("narrows to the given directory", async () => {
		const caller = createCaller(makeContext());
		const result = await caller.getDocTree({ path: path.join(fixtureDir, "sub") });
		expect(result.roots).toHaveLength(1);
		expect(result.roots[0].nodes.map((node) => node.name).sort()).toEqual(["nested.md", "subsub"]);
	});

	it("maxDepth truncates deeper nodes", async () => {
		const caller = createCaller(makeContext());
		// fixtureDir/sub/subsub/deep.md is two directory levels below the root:
		// maxDepth 1 can't descend into "subsub" at all, so it (and everything
		// under it) is pruned from "sub"'s children entirely; maxDepth 8 sees it.
		const shallow = await caller.getDocTree({ maxDepth: 1 });
		const deep = await caller.getDocTree({ maxDepth: 8 });

		const shallowSub = shallow.roots[0].nodes.find((node) => node.name === "sub");
		const deepSub = deep.roots[0].nodes.find((node) => node.name === "sub");

		expect(shallowSub?.children?.map((node) => node.name)).toEqual(["nested.md"]);
		expect(deepSub?.children?.map((node) => node.name).sort()).toEqual(["nested.md", "subsub"]);
		const subsub = deepSub?.children?.find((node) => node.name === "subsub");
		expect(subsub?.children?.map((node) => node.name)).toEqual(["deep.md"]);
	});
});
