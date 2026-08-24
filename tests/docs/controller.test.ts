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
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-docs-controller-test-")),
	);
	outsideDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-docs-controller-outside-")),
	);

	await fs.writeFile(
		path.join(fixtureDir, "good.md"),
		"# Good doc\n\nSome plain GFM content about widgets and gadgets.\n",
		"utf8",
	);
	await fs.writeFile(path.join(outsideDir, "secret.md"), "# Secret\n", "utf8");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
	await fs.rm(outsideDir, { recursive: true, force: true });
});

function makeContext(overrides: Partial<ApiContext> = {}): ApiContext {
	return buildContext(fixtureDir, registry, overrides);
}

const createCaller = createCallerFactory(appRouter);

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
