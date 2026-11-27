import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SearchService } from "../../src/search/service.js";
import { DocCache } from "../../src/docs/doc-cache.js";
import { DocumentService } from "../../src/document/service.js";
import { rootFileUrl } from "../../src/docs/asset-url.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

let dir: string;

const TARGETED = [
	"---",
	"title: Targeted",
	"---",
	"# Guide",
	"",
	"A preamble about quokkas.",
	"",
	"## Section A",
	"",
	"### Nested Narwhal",
	"",
	"body text",
	"",
	"## Section B",
	"",
	'<Tabs id="pick">',
	'<Tab label="One">',
	"",
	"tab body walrus",
	"",
	"</Tab>",
	'<Tab label="Two">',
	"",
	"## Inner Ocelot",
	"",
	"other",
	"",
	"</Tab>",
	"</Tabs>",
	"",
].join("\n");

beforeAll(async () => {
	dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-search-test-")));
	await fs.writeFile(path.join(dir, "guide.md"), "# Guide\n\nA note about widgets.\n", "utf8");
	await fs.writeFile(path.join(dir, "targeted.md"), TARGETED, "utf8");
	await fs.writeFile(path.join(dir, "targeted.mdx"), TARGETED, "utf8");
});

afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

function searchWithDocuments(query: string, file = "targeted.md") {
	const search = new SearchService(new DocCache(), new DocumentService(registry, rootFileUrl));
	return search
		.search([{ name: "docs", dir }], query)
		.results.find((result) => result.path === path.join(dir, file));
}

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

describe("search targetId", () => {
	it.each(["targeted.md", "targeted.mdx"])(
		"a hit in a nested h3 heading targets that heading's section, in %s",
		(file) => {
			expect(searchWithDocuments("narwhal", file)?.targetId).toBe("nested-narwhal");
		},
	);

	it("a hit in a section's body targets the section", () => {
		const parsed = searchWithDocuments("text");
		expect(parsed?.targetId).toBe("nested-narwhal");
	});

	it("a hit in a tab body targets the tab, `<tabsId>><value>`", () => {
		expect(searchWithDocuments("walrus")?.targetId).toBe("pick>one");
	});

	it("a hit in a heading inside a tab targets that heading, not the tab", () => {
		const result = searchWithDocuments("ocelot");
		expect(result?.excerpt).toBe("Inner Ocelot");
		const { tree } = new DocumentService(registry, rootFileUrl).parse(TARGETED, "/x/targeted.md");
		expect(JSON.stringify(tree.children)).toContain(`"id":"${result?.targetId}"`);
		expect(result?.targetId).not.toBe("pick>two");
		expect(result?.targetId).toMatch(/ocelot/);
	});

	it("a hit under the h1, before the first h2, targets the h1's section", () => {
		expect(searchWithDocuments("quokkas")?.targetId).toBe("guide");
	});

	it("a hit in the preamble, before any heading and after the frontmatter, is null", async () => {
		const file = path.join(dir, "preamble.md");
		await fs.writeFile(
			file,
			"---\ntitle: P\n---\nA preamble about pangolins.\n\n# Heading\n\n## Part\n\nbody\n",
			"utf8",
		);
		const result = searchWithDocuments("pangolins", "preamble.md");
		expect(result?.excerpt).toBe("A preamble about pangolins.");
		expect(result?.targetId).toBeNull();
	});

	it("is null for a hit in a doc with no headings at all", async () => {
		await fs.writeFile(path.join(dir, "plain.md"), "plain text about okapis\n", "utf8");
		expect(searchWithDocuments("okapis", "plain.md")?.targetId).toBeNull();
	});

	it("is null without a DocumentService", () => {
		const search = new SearchService(new DocCache());
		const result = search
			.search([{ name: "docs", dir }], "narwhal")
			.results.find((hit) => hit.path === path.join(dir, "targeted.md"));
		expect(result).toBeDefined();
		expect(result?.targetId).toBeNull();
	});

	it("is null for an empty query", () => {
		const search = new SearchService(new DocCache(), new DocumentService(registry, rootFileUrl));
		const results = search.search([{ name: "docs", dir }], "").results;
		expect(results.length).toBeGreaterThan(0);
		for (const result of results) expect(result.targetId).toBeNull();
	});

	it("follows an edit to the doc", async () => {
		const file = path.join(dir, "moving.md");
		await fs.writeFile(file, "# Top\n\n## First\n\nmarmot lives here\n", "utf8");
		const search = new SearchService(new DocCache(), new DocumentService(registry, rootFileUrl));
		const find = () =>
			search
				.search([{ name: "docs", dir }], "marmot")
				.results.find((result) => result.path === file);
		expect(find()?.targetId).toBe("first");
		await fs.writeFile(file, "# Top\n\n## Second\n\nmarmot lives here\n", "utf8");
		const later = new Date(Date.now() + 5000);
		await fs.utimes(file, later, later);
		expect(find()?.targetId).toBe("second");
	});
});
