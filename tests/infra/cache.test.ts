import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	cacheKeyFor,
	cleanCache,
	getCacheDir,
	getCacheHome,
	getViteCacheDir,
} from "../../src/infra/cache.js";

let tmpDir: string;
const savedEnv = {
	MDXSERVE_CACHE_HOME: process.env.MDXSERVE_CACHE_HOME,
	XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
};

beforeAll(async () => {
	tmpDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-cache-test-")));
});

afterEach(() => {
	for (const [name, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

afterAll(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("getCacheHome", () => {
	it("defaults to ~/.cache/mdxserve", () => {
		delete process.env.MDXSERVE_CACHE_HOME;
		delete process.env.XDG_CACHE_HOME;
		expect(getCacheHome()).toBe(path.join(os.homedir(), ".cache", "mdxserve"));
	});

	it("honours XDG_CACHE_HOME", () => {
		delete process.env.MDXSERVE_CACHE_HOME;
		process.env.XDG_CACHE_HOME = tmpDir;
		expect(getCacheHome()).toBe(path.join(tmpDir, "mdxserve"));
	});

	it("MDXSERVE_CACHE_HOME wins over XDG_CACHE_HOME", () => {
		process.env.XDG_CACHE_HOME = path.join(tmpDir, "xdg");
		process.env.MDXSERVE_CACHE_HOME = path.join(tmpDir, "override");
		expect(getCacheHome()).toBe(path.join(tmpDir, "override"));
	});
});

describe("getCacheDir", () => {
	it("lives under the cache home, never inside the served root", () => {
		process.env.MDXSERVE_CACHE_HOME = tmpDir;
		const root = path.join(tmpDir, "docs");
		const dir = getCacheDir(root);
		expect(path.dirname(dir)).toBe(tmpDir);
		expect(dir.startsWith(root + path.sep)).toBe(false);
		expect(getViteCacheDir(root)).toBe(path.join(dir, "vite"));
	});

	it("keys two roots with the same basename to different folders", () => {
		const first = cacheKeyFor("/a/docs");
		const second = cacheKeyFor("/b/docs");
		expect(first).not.toBe(second);
		expect(first.startsWith("docs-")).toBe(true);
		expect(second.startsWith("docs-")).toBe(true);
	});
});

describe("cacheKeyFor", () => {
	it("keys a symlinked root the same as its target, so clean finds the served cache", async () => {
		const target = path.join(tmpDir, "real-docs");
		await fs.mkdir(target, { recursive: true });
		const link = path.join(tmpDir, "linked-docs");
		await fs.symlink(target, link, "dir");
		expect(cacheKeyFor(link)).toBe(cacheKeyFor(target));
	});

	it("keeps the key under the filename limit for a very long basename", () => {
		const key = cacheKeyFor("/" + "x".repeat(240));
		expect(Buffer.byteLength(key)).toBeLessThanOrEqual(255);
	});
});

describe("cleanCache", () => {
	it("removes the root's cache folder and reports whether anything was there", async () => {
		process.env.MDXSERVE_CACHE_HOME = tmpDir;
		const root = path.join(tmpDir, "served");
		await fs.mkdir(path.join(getViteCacheDir(root), "deps"), { recursive: true });
		await fs.writeFile(path.join(getViteCacheDir(root), "deps", "x.js"), "");

		expect(cleanCache(root)).toBe(true);
		await expect(fs.stat(getCacheDir(root))).rejects.toThrow();
		expect(cleanCache(root)).toBe(false);
	});
});
