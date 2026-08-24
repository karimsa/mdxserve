import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "../src/api/trpc.js";
import { appRouter } from "../src/api/router.js";
import type { ApiContext } from "../src/api/trpc.js";
import { moveDocsToTrash } from "../src/trash-docs.js";
import type { RenderOutcome } from "../src/render.js";
import { fixtureRegistry as registry } from "./fixtures/registry.js";

let fixtureDir: string;
let outsideDir: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-api-router-test-")),
	);
	outsideDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-api-router-outside-")),
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
	return {
		roots: [fixtureDir],
		rootInfos: [{ name: "docs", dir: fixtureDir }],
		registry,
		isLoopback: false,
		...overrides,
	};
}

const createCaller = createCallerFactory(appRouter);

describe("procedure descriptions", () => {
	it("every procedure has a well-formed meta.description", () => {
		const procedures = appRouter._def.procedures as Record<
			string,
			{ meta?: { description?: string } }
		>;
		const names = Object.keys(procedures);
		expect(names.length).toBeGreaterThan(0);
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
				roots: [fixtureDir, outsideDir],
				rootInfos: [
					{ name: "docs", dir: fixtureDir },
					{ name: "other", dir: outsideDir },
				],
			}),
		);
		const result = await caller.getDocTree({});
		expect(result.roots.map((r) => r.name).sort()).toEqual(["docs", "other"].sort());
	});

	it("narrows to the given directory", async () => {
		const caller = createCaller(makeContext());
		const result = await caller.getDocTree({ path: path.join(fixtureDir, "sub") });
		expect(result.roots).toHaveLength(1);
		expect(result.roots[0].nodes.map((n) => n.name).sort()).toEqual(["nested.md", "subsub"]);
	});

	it("maxDepth truncates deeper nodes", async () => {
		const caller = createCaller(makeContext());
		// fixtureDir/sub/subsub/deep.md is two directory levels below the root:
		// maxDepth 1 can't descend into "subsub" at all, so it (and everything
		// under it) is pruned from "sub"'s children entirely; maxDepth 8 sees it.
		const shallow = await caller.getDocTree({ maxDepth: 1 });
		const deep = await caller.getDocTree({ maxDepth: 8 });

		const shallowSub = shallow.roots[0].nodes.find((n) => n.name === "sub");
		const deepSub = deep.roots[0].nodes.find((n) => n.name === "sub");

		expect(shallowSub?.children?.map((n) => n.name)).toEqual(["nested.md"]);
		expect(deepSub?.children?.map((n) => n.name).sort()).toEqual(["nested.md", "subsub"]);
		const subsub = deepSub?.children?.find((n) => n.name === "subsub");
		expect(subsub?.children?.map((n) => n.name)).toEqual(["deep.md"]);
	});
});

describe("searchDocs", () => {
	it("finds a fixture word and every result has a numeric score", async () => {
		const caller = createCaller(makeContext());
		const result = await caller.searchDocs({ query: "widgets" });
		expect(result.results.length).toBeGreaterThan(0);
		for (const entry of result.results) {
			expect(entry.score).toBeTypeOf("number");
		}
		expect(result.results.map((r) => r.path)).toContain(path.join(fixtureDir, "good.md"));
	});
});

describe("moveDocsToTrash (src/trash-docs.ts directly)", () => {
	let trashDir: string;
	let escapeOutside: string;

	beforeAll(async () => {
		trashDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-trash-test-")));
		escapeOutside = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-trash-outside-")),
		);
		await fs.writeFile(path.join(trashDir, "delete-me.md"), "# Bye\n", "utf8");
		await fs.mkdir(path.join(trashDir, "adir"));
		await fs.writeFile(path.join(trashDir, ".dotfile.md"), "# Dot\n", "utf8");
		await fs.symlink(escapeOutside, path.join(trashDir, "escape"), "dir");
		await fs.writeFile(path.join(escapeOutside, "outside.md"), "# Outside\n", "utf8");
	});

	afterAll(async () => {
		await fs.rm(trashDir, { recursive: true, force: true });
		await fs.rm(escapeOutside, { recursive: true, force: true });
	});

	it("deletes a real file via the injected trashFile spy", async () => {
		const spy = vi.fn(async () => {});
		const target = path.join(trashDir, "delete-me.md");
		const result = await moveDocsToTrash([trashDir], [target], spy);
		expect(result.deleted).toEqual([target]);
		expect(result.failed).toEqual([]);
		expect(spy).toHaveBeenCalledWith(target);
	});

	it("fails a directory with 'Is a directory'", async () => {
		const spy = vi.fn(async () => {});
		const target = path.join(trashDir, "adir");
		const result = await moveDocsToTrash([trashDir], [target], spy);
		expect(result.failed).toEqual([{ path: target, error: "Is a directory" }]);
		expect(spy).not.toHaveBeenCalled();
	});

	it("fails an outside-root path with 'Invalid path'", async () => {
		const spy = vi.fn(async () => {});
		const target = path.join(escapeOutside, "outside.md");
		const result = await moveDocsToTrash([trashDir], [target], spy);
		expect(result.failed).toEqual([{ path: target, error: "Invalid path" }]);
		expect(spy).not.toHaveBeenCalled();
	});

	it("fails a dotfile with 'Invalid path'", async () => {
		const spy = vi.fn(async () => {});
		const target = path.join(trashDir, ".dotfile.md");
		const result = await moveDocsToTrash([trashDir], [target], spy);
		expect(result.failed).toEqual([{ path: target, error: "Invalid path" }]);
		expect(spy).not.toHaveBeenCalled();
	});

	it("fails a path through a symlink that escapes the root with 'Invalid path'", async () => {
		const spy = vi.fn(async () => {});
		const target = path.join(trashDir, "escape", "outside.md");
		const result = await moveDocsToTrash([trashDir], [target], spy);
		expect(result.failed).toEqual([{ path: target, error: "Invalid path" }]);
		expect(spy).not.toHaveBeenCalled();
	});
});

describe("validateDoc render gating", () => {
	it("isLoopback: false never runs the render stub (rendered: false)", async () => {
		const render = vi.fn(async (): Promise<RenderOutcome> => ({ ok: true }));
		const caller = createCaller(makeContext({ isLoopback: false, render }));
		const result = await caller.validateDoc({ path: path.join(fixtureDir, "good.md") });
		expect(result.rendered).toBe(false);
		expect(render).not.toHaveBeenCalled();
	});

	it("isLoopback: true runs the render stub (rendered: true)", async () => {
		const render = vi.fn(async (): Promise<RenderOutcome> => ({ ok: true }));
		const caller = createCaller(makeContext({ isLoopback: true, render }));
		const result = await caller.validateDoc({ path: path.join(fixtureDir, "good.md") });
		expect(result.rendered).toBe(true);
		expect(render).toHaveBeenCalledOnce();
	});

	it("throws NOT_FOUND for a path outside every root", async () => {
		const caller = createCaller(makeContext());
		await expect(
			caller.validateDoc({ path: path.join(outsideDir, "secret.md") }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("getDocSource", () => {
	it("returns the raw text and the file's mtime", async () => {
		const abs = path.join(fixtureDir, "good.md");
		const stat = await fs.stat(abs);
		const source = await createCaller(makeContext()).getDocSource({ path: abs });
		expect(source.text).toBe(await fs.readFile(abs, "utf8"));
		expect(source.mtime).toBe(stat.mtimeMs);
	});

	it("rejects a path outside every root with NOT_FOUND", async () => {
		await expect(
			createCaller(makeContext()).getDocSource({ path: path.join(outsideDir, "secret.md") }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects a file over the editor size cap with PAYLOAD_TOO_LARGE", async () => {
		const abs = path.join(fixtureDir, "huge.md");
		await fs.writeFile(abs, "# Huge\n\n" + "x".repeat(2 * 1024 * 1024 + 1), "utf8");
		try {
			await expect(createCaller(makeContext()).getDocSource({ path: abs })).rejects.toMatchObject({
				code: "PAYLOAD_TOO_LARGE",
			});
		} finally {
			await fs.rm(abs, { force: true });
		}
	});
});

describe("saveDocSection", () => {
	const original = "# Title\n\nline three\n\nline five\n";
	let counter = 0;

	async function freshDoc(): Promise<string> {
		const abs = path.join(fixtureDir, `edit-${counter++}.md`);
		await fs.writeFile(abs, original, "utf8");
		return abs;
	}

	it("replaces exactly the requested line range and returns the new mtime", async () => {
		const abs = await freshDoc();
		const before = await fs.stat(abs);
		const result = await createCaller(makeContext()).saveDocSection({
			path: abs,
			startLine: 3,
			endLine: 3,
			mtime: before.mtimeMs,
			markdown: "changed line\n",
		});
		expect(await fs.readFile(abs, "utf8")).toBe("# Title\n\nchanged line\n\nline five\n");
		expect(result.mtime).toBe((await fs.stat(abs)).mtimeMs);
	});

	it("rejects a stale mtime with CONFLICT and leaves the file untouched", async () => {
		const abs = await freshDoc();
		await expect(
			createCaller(makeContext()).saveDocSection({
				path: abs,
				startLine: 3,
				endLine: 3,
				mtime: 1,
				markdown: "changed",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await fs.readFile(abs, "utf8")).toBe(original);
	});

	it("rejects a line range past the end of the file with CONFLICT", async () => {
		const abs = await freshDoc();
		const before = await fs.stat(abs);
		await expect(
			createCaller(makeContext()).saveDocSection({
				path: abs,
				startLine: 3,
				endLine: 99,
				mtime: before.mtimeMs,
				markdown: "changed",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await fs.readFile(abs, "utf8")).toBe(original);
	});

	it("rejects markdown that would break the doc with UNPROCESSABLE_CONTENT, without writing", async () => {
		const abs = await freshDoc();
		const before = await fs.stat(abs);
		await expect(
			createCaller(makeContext()).saveDocSection({
				path: abs,
				startLine: 3,
				endLine: 3,
				mtime: before.mtimeMs,
				markdown: "<Calout>not a real component</Calout>",
			}),
		).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
		expect(await fs.readFile(abs, "utf8")).toBe(original);
	});

	it("rejects a path outside every root with NOT_FOUND", async () => {
		await expect(
			createCaller(makeContext()).saveDocSection({
				path: path.join(outsideDir, "secret.md"),
				startLine: 1,
				endLine: 1,
				mtime: 0,
				markdown: "x",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
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
