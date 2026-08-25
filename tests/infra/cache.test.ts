import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanCache, getCacheHome, getViteCacheDir } from "../../src/infra/cache.js";

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

describe("getViteCacheDir", () => {
	it("lives directly under the cache home", () => {
		process.env.MDXSERVE_CACHE_HOME = tmpDir;
		expect(getViteCacheDir()).toBe(path.join(tmpDir, "vite"));
		expect(path.dirname(getViteCacheDir())).toBe(getCacheHome());
	});
});

describe("cleanCache", () => {
	it("removes the whole cache home and reports whether anything was there", async () => {
		process.env.MDXSERVE_CACHE_HOME = path.join(tmpDir, "clean-test");
		await fs.mkdir(path.join(getViteCacheDir(), "deps"), { recursive: true });
		await fs.writeFile(path.join(getViteCacheDir(), "deps", "x.js"), "");

		expect(cleanCache()).toBe(true);
		await expect(fs.stat(getCacheHome())).rejects.toThrow();
		expect(cleanCache()).toBe(false);
	});
});
