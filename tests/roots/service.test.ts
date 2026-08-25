import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
	it("expands a leading ~/ against the home it was given", async () => {
		const home = await mkTmpDir("home-");
		await fs.mkdir(path.join(home, "docs"));
		const result = await new RootsService("/nowhere", home).admit(["~/docs"]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.roots).toEqual([path.join(home, "docs")]);
	});

	it("does not treat ~user as a home shortcut", async () => {
		const home = await mkTmpDir("home-");
		const result = await new RootsService(home, home).admit(["~nobody"]);
		expect(result.kind).toBe("not-found");
	});

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

	it("admits an empty set of roots for an empty input list", async () => {
		const dir = await mkTmpDir("default-");
		const result = await new RootsService(dir).admit([]);
		expect(result).toEqual({ kind: "ok", roots: [], rootInfos: [] });
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

describe("RootsService mounted set", () => {
	it("starts with the seeded mounted list", async () => {
		const dir = await mkTmpDir("seed-");
		const service = new RootsService(process.cwd(), os.homedir(), [dir]);
		expect(service.list()).toEqual([{ name: path.basename(dir), dir }]);
	});

	it("add() mounts a new directory", async () => {
		const dir = await mkTmpDir("add-");
		const service = new RootsService(process.cwd());
		const result = await service.add([dir]);
		expect(result).toEqual({
			kind: "ok",
			added: [dir],
			roots: [{ name: path.basename(dir), dir }],
		});
		expect(service.list()).toEqual([{ name: path.basename(dir), dir }]);
	});

	it("re-adding an already-mounted root is ok with an empty added list and no listener call", async () => {
		const dir = await mkTmpDir("readd-");
		const service = new RootsService(process.cwd(), os.homedir(), [dir]);
		const listener = vi.fn();
		service.onChange(listener);

		const result = await service.add([dir]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.added).toEqual([]);
		expect(listener).not.toHaveBeenCalled();
	});

	it("refuses adding a directory nested inside an already-mounted root", async () => {
		const outer = await mkTmpDir("mounted-outer-");
		const inner = path.join(outer, "inner");
		await fs.mkdir(inner);
		const service = new RootsService(process.cwd(), os.homedir(), [outer]);
		const result = await service.add([inner]);
		expect(result.kind).toBe("nested");
	});

	it("refuses adding a parent of an already-mounted root", async () => {
		const outer = await mkTmpDir("mounted-parent-");
		const inner = path.join(outer, "inner");
		await fs.mkdir(inner);
		const service = new RootsService(process.cwd(), os.homedir(), [inner]);
		const result = await service.add([outer]);
		expect(result.kind).toBe("nested");
	});

	it("refuses adding /", async () => {
		const service = new RootsService(process.cwd());
		const result = await service.add(["/"]);
		expect(result.kind).toBe("refused");
	});

	it("reports a missing directory as not-found", async () => {
		const dir = await mkTmpDir("add-missing-");
		const absent = path.join(dir, "nope");
		const service = new RootsService(process.cwd());
		const result = await service.add([absent]);
		expect(result.kind).toBe("not-found");
	});

	it("reports a file as not-a-directory", async () => {
		const dir = await mkTmpDir("add-file-");
		const file = path.join(dir, "doc.md");
		await fs.writeFile(file, "# Doc\n", "utf8");
		const service = new RootsService(process.cwd());
		const result = await service.add([file]);
		expect(result.kind).toBe("not-a-directory");
	});

	it("leaves the mounted set unchanged after a failed add", async () => {
		const dir = await mkTmpDir("keep-");
		const service = new RootsService(process.cwd(), os.homedir(), [dir]);
		const before = service.list();
		await service.add(["/"]);
		expect(service.list()).toEqual(before);
	});

	it("remove() unmounts a mounted root", async () => {
		const dir = await mkTmpDir("remove-");
		const service = new RootsService(process.cwd(), os.homedir(), [dir]);
		const result = await service.remove([dir]);
		expect(result).toEqual({ kind: "ok", removed: [dir], roots: [] });
		expect(service.list()).toEqual([]);
	});

	it("remove() reports an unmounted directory as not-mounted", async () => {
		const dir = await mkTmpDir("remove-unknown-");
		const service = new RootsService(process.cwd());
		const result = await service.remove([dir]);
		expect(result).toEqual({ kind: "not-mounted", message: `not mounted: ${dir}` });
	});

	it("remove() accepts a symlinked alias of a mounted root", async () => {
		const real = await mkTmpDir("remove-real-");
		const linkParent = await mkTmpDir("remove-link-");
		const alias = path.join(linkParent, "alias");
		await fs.symlink(real, alias, "dir");
		const service = new RootsService(process.cwd(), os.homedir(), [real]);
		const result = await service.remove([alias]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.removed).toEqual([real]);
	});

	it("remove() still works after the mounted directory itself was deleted", async () => {
		const dir = await mkTmpDir("remove-deleted-");
		const service = new RootsService(process.cwd(), os.homedir(), [dir]);
		await fs.rm(dir, { recursive: true, force: true });
		const result = await service.remove([dir]);
		expect(result).toEqual({ kind: "ok", removed: [dir], roots: [] });
	});

	it("remove() resolves a symlinked spelling of a root whose directory was deleted", async () => {
		// The mounted root is stored as a realpath; once its directory is gone
		// the input can't be realpath'd whole, but its surviving ancestor can.
		const base = await mkTmpDir("symlink-deleted-");
		await fs.mkdir(path.join(base, "target", "sub"), { recursive: true });
		await fs.symlink(path.join(base, "target"), path.join(base, "link"), "dir");
		const realSub = path.join(base, "target", "sub");
		const service = new RootsService(process.cwd(), os.homedir(), [realSub]);
		await fs.rm(realSub, { recursive: true });
		const result = await service.remove([path.join(base, "link", "sub")]);
		expect(result).toEqual({ kind: "ok", removed: [realSub], roots: [] });
	});

	it("removing one of two same-basename roots restores the plain name on the survivor", async () => {
		const first = await mkTmpDir("collide-a-");
		const second = await mkTmpDir("collide-b-");
		const firstDocs = path.join(first, "docs");
		const secondDocs = path.join(second, "docs");
		await fs.mkdir(firstDocs);
		await fs.mkdir(secondDocs);
		const service = new RootsService(process.cwd(), os.homedir(), [firstDocs, secondDocs]);

		const result = await service.remove([firstDocs]);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.roots).toEqual([{ name: "docs", dir: secondDocs }]);
	});

	it("onChange receives {added, removed, roots} once per effective mutation", async () => {
		const dir = await mkTmpDir("notify-");
		const service = new RootsService(process.cwd());
		const changes: unknown[] = [];
		service.onChange((change) => {
			changes.push(change);
		});

		await service.add([dir]);
		await service.remove([dir]);

		expect(changes).toEqual([
			{ added: [dir], removed: [], roots: [{ name: path.basename(dir), dir }] },
			{ added: [], removed: [dir], roots: [] },
		]);
	});

	it("unsubscribe stops further delivery", async () => {
		const dir = await mkTmpDir("unsub-");
		const service = new RootsService(process.cwd());
		const listener = vi.fn();
		const unsubscribe = service.onChange(listener);
		unsubscribe();

		await service.add([dir]);
		expect(listener).not.toHaveBeenCalled();
	});

	it("an async listener is awaited before add() resolves", async () => {
		const dir = await mkTmpDir("await-listener-");
		const service = new RootsService(process.cwd());
		let listenerFinished = false;
		service.onChange(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			listenerFinished = true;
		});

		await service.add([dir]);
		expect(listenerFinished).toBe(true);
	});
});
