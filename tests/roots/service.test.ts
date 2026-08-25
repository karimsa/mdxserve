import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RootsService } from "../../src/roots/service.js";

const made: string[] = [];

async function mkTmpDir(prefix: string): Promise<string> {
	const dir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), `mdxserve-roots-${prefix}`)),
	);
	made.push(dir);
	return dir;
}

afterEach(async () => {
	while (made.length > 0) {
		const dir = made.pop();
		if (dir) await fs.rm(dir, { recursive: true, force: true });
	}
});

describe("RootsService.admit", () => {
	it("admits a directory and names it by its basename", async () => {
		const dir = await mkTmpDir("ok-");
		const result = await new RootsService(process.cwd()).admit([dir]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.roots).toEqual([dir]);
		expect(result.rootInfos).toEqual([{ name: path.basename(dir), dir }]);
	});

	it("resolves a relative input against the cwd it was constructed with", async () => {
		const parent = await mkTmpDir("cwd-");
		await fs.mkdir(path.join(parent, "docs"));
		const result = await new RootsService(parent).admit(["docs"]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.roots).toEqual([path.join(parent, "docs")]);
	});

	it("treats no inputs as the current directory", async () => {
		const dir = await mkTmpDir("default-");
		const result = await new RootsService(dir).admit([]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.roots).toEqual([dir]);
	});

	it("reports a missing directory as not-found, naming the absolute path", async () => {
		const dir = await mkTmpDir("missing-");
		const absent = path.join(dir, "nope");
		const result = await new RootsService(process.cwd()).admit([absent]);
		expect(result).toEqual({ kind: "not-found", message: `no such directory: ${absent}` });
	});

	it("reports a file as not-a-directory", async () => {
		const dir = await mkTmpDir("file-");
		const file = path.join(dir, "doc.md");
		await fs.writeFile(file, "# Doc\n", "utf8");
		const result = await new RootsService(process.cwd()).admit([file]);
		expect(result).toEqual({ kind: "not-a-directory", message: `not a directory: ${file}` });
	});

	it("refuses to serve /", async () => {
		const result = await new RootsService(process.cwd()).admit(["/"]);
		expect(result).toEqual({ kind: "refused", message: "refusing to serve /" });
	});

	it("refuses a root nested inside another, naming both", async () => {
		const outer = await mkTmpDir("outer-");
		const inner = path.join(outer, "inner");
		await fs.mkdir(inner);
		const result = await new RootsService(process.cwd()).admit([outer, inner]);
		expect(result).toEqual({
			kind: "nested",
			message: `${inner} is inside ${outer}; serve only the outer one`,
		});
	});

	it("refuses nesting whichever order the roots are named in", async () => {
		const outer = await mkTmpDir("order-");
		const inner = path.join(outer, "inner");
		await fs.mkdir(inner);
		const result = await new RootsService(process.cwd()).admit([inner, outer]);
		expect(result.kind).toBe("nested");
	});

	it("drops a symlinked alias of an already-named root instead of serving it twice", async () => {
		const real = await mkTmpDir("real-");
		const linkParent = await mkTmpDir("link-");
		const alias = path.join(linkParent, "alias");
		await fs.symlink(real, alias, "dir");
		const result = await new RootsService(process.cwd()).admit([real, alias]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.roots).toEqual([real]);
	});

	it("disambiguates two roots whose basenames collide", async () => {
		const first = await mkTmpDir("collide-a-");
		const second = await mkTmpDir("collide-b-");
		await fs.mkdir(path.join(first, "docs"));
		await fs.mkdir(path.join(second, "docs"));
		const result = await new RootsService(process.cwd()).admit([
			path.join(first, "docs"),
			path.join(second, "docs"),
		]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		const names = result.rootInfos.map((rootInfo) => rootInfo.name);
		expect(new Set(names).size).toBe(2);
		for (const name of names) expect(name.startsWith("docs (")).toBe(true);
	});
});

describe("RootsService.reconcile", () => {
	it("keeps the outer root and drops one nested inside it", () => {
		const service = new RootsService(process.cwd());
		expect(service.reconcile(["/srv/docs", "/srv/docs/guide"])).toEqual([
			{ name: "docs", dir: "/srv/docs" },
		]);
	});

	it("dedupes the same root reported by two servers", () => {
		const service = new RootsService(process.cwd());
		expect(service.reconcile(["/srv/docs", "/srv/docs"])).toEqual([
			{ name: "docs", dir: "/srv/docs" },
		]);
	});

	it("does not refuse nesting the way admit does — the bridge unions independent servers", () => {
		const service = new RootsService(process.cwd());
		expect(service.reconcile(["/a/docs/inner", "/a/docs"]).map((info) => info.dir)).toEqual([
			"/a/docs",
		]);
	});
});
