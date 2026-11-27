import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ListingService } from "../../src/listing/service.js";
import { DocCache } from "../../src/docs/doc-cache.js";

let fixtureDir: string;
let outsideDir: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-listing-service-test-")),
	);
	outsideDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-listing-service-outside-")),
	);

	await fs.writeFile(path.join(fixtureDir, "good.md"), "# Good doc\n\nSome content.\n", "utf8");
	await fs.mkdir(path.join(fixtureDir, "sub"));
	await fs.writeFile(
		path.join(fixtureDir, "sub", "nested.md"),
		"# Nested\n\nNested content.\n",
		"utf8",
	);
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
	await fs.rm(outsideDir, { recursive: true, force: true });
});

function makeService(): ListingService {
	const rootInfos = [{ name: "docs", dir: fixtureDir }];
	return new ListingService(rootInfos, new DocCache());
}

describe("ListingService.folderListing", () => {
	it("returns ok with the directory's entries", async () => {
		const result = await makeService().folderListing(fixtureDir);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.listing.rootName).toBe("docs");
		expect(result.listing.rootDir).toBe(fixtureDir);
		expect(result.listing.entries.map((entry) => entry.name).sort()).toEqual(["good.md", "sub"]);
	});

	it("returns not-found for a path outside every root", async () => {
		const result = await makeService().folderListing(outsideDir);
		expect(result).toEqual({ kind: "not-found", message: "Not found" });
	});

	it("returns not-found for a file path", async () => {
		const result = await makeService().folderListing(path.join(fixtureDir, "good.md"));
		expect(result).toEqual({ kind: "not-found", message: "Not found" });
	});
});

describe("ListingService.docTree", () => {
	it("with no path, returns one entry per rootInfo", async () => {
		const rootInfos = [
			{ name: "docs", dir: fixtureDir },
			{ name: "other", dir: outsideDir },
		];
		const service = new ListingService(rootInfos, new DocCache());
		const result = await service.docTree({ maxDepth: 8 });
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.roots.map((rootEntry) => rootEntry.name).sort()).toEqual(["docs", "other"]);
		expect(result.dirAbs).toBeUndefined();
	});

	it("narrows to the given directory and sets dirAbs", async () => {
		const result = await makeService().docTree({ path: path.join(fixtureDir, "sub"), maxDepth: 8 });
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.roots).toHaveLength(1);
		expect(result.roots[0].nodes.map((node) => node.name)).toEqual(["nested.md"]);
		expect(result.dirAbs).toBe(path.join(fixtureDir, "sub"));
	});

	it("returns not-found for a path outside every root", async () => {
		const result = await makeService().docTree({ path: outsideDir, maxDepth: 8 });
		expect(result.kind).toBe("not-found");
	});
});
