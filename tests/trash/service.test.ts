import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TrashService } from "../../src/trash/service.js";

describe("TrashService", () => {
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
		const result = await new TrashService([{ name: "docs", dir: trashDir }], spy).moveToTrash([
			target,
		]);
		expect(result.deleted).toEqual([target]);
		expect(result.failed).toEqual([]);
		expect(spy).toHaveBeenCalledWith(target);
	});

	it("fails a directory with 'Is a directory'", async () => {
		const spy = vi.fn(async () => {});
		const target = path.join(trashDir, "adir");
		const result = await new TrashService([{ name: "docs", dir: trashDir }], spy).moveToTrash([
			target,
		]);
		expect(result.failed).toEqual([{ path: target, error: "Is a directory" }]);
		expect(spy).not.toHaveBeenCalled();
	});

	it("fails an outside-root path with 'Invalid path'", async () => {
		const spy = vi.fn(async () => {});
		const target = path.join(escapeOutside, "outside.md");
		const result = await new TrashService([{ name: "docs", dir: trashDir }], spy).moveToTrash([
			target,
		]);
		expect(result.failed).toEqual([{ path: target, error: "Invalid path" }]);
		expect(spy).not.toHaveBeenCalled();
	});

	it("fails a dotfile with 'Invalid path'", async () => {
		const spy = vi.fn(async () => {});
		const target = path.join(trashDir, ".dotfile.md");
		const result = await new TrashService([{ name: "docs", dir: trashDir }], spy).moveToTrash([
			target,
		]);
		expect(result.failed).toEqual([{ path: target, error: "Invalid path" }]);
		expect(spy).not.toHaveBeenCalled();
	});

	it("fails a path through a symlink that escapes the root with 'Invalid path'", async () => {
		const spy = vi.fn(async () => {});
		const target = path.join(trashDir, "escape", "outside.md");
		const result = await new TrashService([{ name: "docs", dir: trashDir }], spy).moveToTrash([
			target,
		]);
		expect(result.failed).toEqual([{ path: target, error: "Invalid path" }]);
		expect(spy).not.toHaveBeenCalled();
	});
});
