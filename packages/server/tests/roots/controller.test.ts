import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import type { ApiContext } from "../../src/api/trpc.js";
import { RootsService } from "../../src/roots/service.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext as buildContext } from "../helpers/context.js";

let fixtureDir: string;
const made: string[] = [];

beforeAll(async () => {
	fixtureDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-roots-controller-test-")),
	);
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
});

afterEach(async () => {
	while (made.length > 0) {
		const dir = made.pop();
		if (dir) await fs.rm(dir, { recursive: true, force: true });
	}
});

async function mkTmpDir(prefix: string): Promise<string> {
	const dir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), `mdxserve-roots-controller-${prefix}`)),
	);
	made.push(dir);
	return dir;
}

const createCaller = createCallerFactory(appRouter);

/** A fresh caller bound to a snapshot of `roots` taken right now — mirrors a real per-request context. */
function callerFor(roots: RootsService, overrides: Partial<ApiContext> = {}) {
	const context = buildContext(fixtureDir, registry, {
		roots,
		rootInfos: roots.list(),
		isLoopback: true,
		...overrides,
	});
	return createCaller(context);
}

describe("addRoots / removeRoots loopback gating", () => {
	it("addRoots is FORBIDDEN for a non-loopback caller", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), []);
		const caller = callerFor(roots, { isLoopback: false });
		await expect(caller.addRoots({ dirs: [fixtureDir] })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(roots.list()).toEqual([]);
	});

	it("removeRoots is FORBIDDEN for a non-loopback caller", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), [fixtureDir]);
		const caller = callerFor(roots, { isLoopback: false });
		await expect(caller.removeRoots({ dirs: [fixtureDir] })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		expect(roots.list()).toEqual([{ name: path.basename(fixtureDir), dir: fixtureDir }]);
	});
});

describe("addRoots result mapping", () => {
	it("ok: mounts the directory and returns it in added and roots", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), []);
		const result = await callerFor(roots).addRoots({ dirs: [fixtureDir] });
		expect(result.added).toEqual([fixtureDir]);
		expect(result.roots).toEqual([{ name: path.basename(fixtureDir), dir: fixtureDir }]);
	});

	it("not-found: NOT_FOUND", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), []);
		const absent = path.join(fixtureDir, "nope");
		await expect(callerFor(roots).addRoots({ dirs: [absent] })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("not-a-directory: BAD_REQUEST", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), []);
		const file = path.join(fixtureDir, "file.md");
		await fs.writeFile(file, "# Doc\n", "utf8");
		try {
			await expect(callerFor(roots).addRoots({ dirs: [file] })).rejects.toMatchObject({
				code: "BAD_REQUEST",
			});
		} finally {
			await fs.rm(file, { force: true });
		}
	});

	it("refused (/): FORBIDDEN", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), []);
		await expect(callerFor(roots).addRoots({ dirs: ["/"] })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("nested: CONFLICT", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), [fixtureDir]);
		const inner = path.join(fixtureDir, "inner");
		await fs.mkdir(inner, { recursive: true });
		try {
			await expect(callerFor(roots).addRoots({ dirs: [inner] })).rejects.toMatchObject({
				code: "CONFLICT",
			});
		} finally {
			await fs.rm(inner, { recursive: true, force: true });
		}
	});

	it("a relative path is rejected by the schema with BAD_REQUEST", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), []);
		await expect(callerFor(roots).addRoots({ dirs: ["relative/path"] })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		expect(roots.list()).toEqual([]);
	});
});

describe("removeRoots result mapping", () => {
	it("ok: unmounts the directory", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), [fixtureDir]);
		const result = await callerFor(roots).removeRoots({ dirs: [fixtureDir] });
		expect(result.removed).toEqual([fixtureDir]);
		expect(result.roots).toEqual([]);
	});

	it("not-mounted: NOT_FOUND", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), []);
		await expect(callerFor(roots).removeRoots({ dirs: [fixtureDir] })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("a relative path is rejected by the schema with BAD_REQUEST", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), [fixtureDir]);
		await expect(callerFor(roots).removeRoots({ dirs: ["relative/path"] })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		expect(roots.list()).toEqual([{ name: path.basename(fixtureDir), dir: fixtureDir }]);
	});
});

describe("listRoots", () => {
	it("reflects a prior addRoots against the same RootsService", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), []);
		const other = await mkTmpDir("list-");

		expect((await callerFor(roots).listRoots()).roots).toEqual([]);

		const added = await callerFor(roots).addRoots({ dirs: [other] });
		expect(added.added).toEqual([other]);

		const after = await callerFor(roots).listRoots();
		expect(after.roots).toEqual([{ name: path.basename(other), dir: other }]);
	});
});
