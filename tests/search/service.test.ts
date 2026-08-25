import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchService } from "../../src/search/service.js";
import { DocCache } from "../../src/docs/doc-cache.js";

let dir: string;

beforeAll(async () => {
	dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-search-test-")));
	await fs.writeFile(path.join(dir, "guide.md"), "# Guide\n\nA note about widgets.\n", "utf8");
});

afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe("search", () => {
	it("re-labels an unchanged doc when its root's display name changes", () => {
		const search = new SearchService(new DocCache());
		const first = search.search([{ name: "docs", dir }], "widgets").results;
		expect(first.map((result) => result.label)).toEqual(["docs/guide.md"]);

		// Same file, same mtime, different root name (e.g. a second server with
		// a colliding basename appeared and the names were disambiguated).
		const second = search.search([{ name: "docs (a)", dir }], "widgets").results;
		expect(second.map((result) => result.label)).toEqual(["docs (a)/guide.md"]);
	});
});
