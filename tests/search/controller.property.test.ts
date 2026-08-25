import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { z } from "zod";
import { readTree, type TreeNode } from "../../src/listing/tree.js";
import { DocCache } from "../../src/docs/doc-cache.js";
import { SearchService } from "../../src/search/service.js";
import { searchResultSchema } from "../../src/search/controller.js";

const PROPERTY_TIMEOUT_MS = 30000;

// --- generator: a small tmpdir tree from a 3-letter alphabet -------------

type DocEntry = { type: "doc"; name: string; body: string };
type TxtEntry = { type: "txt"; name: string };
type DotfileEntry = { type: "dotfile"; name: string };
type DirEntry = { type: "dir"; name: string; children: EntrySpec[] };
type NodeModulesEntry = { type: "node_modules"; name: "node_modules"; children: EntrySpec[] };
type EntrySpec = DocEntry | TxtEntry | DotfileEntry | DirEntry | NodeModulesEntry;

const letter = fc.constantFrom("a", "b", "c");

function leafArbs(): fc.Arbitrary<EntrySpec>[] {
	return [
		fc.tuple(letter, fc.constantFrom("md", "mdx")).map(([name, ext]): EntrySpec => ({
			type: "doc",
			name: `${name}.${ext}`,
			body: `# ${name}\n\nplain body about ${name}.\n`,
		})),
		letter.map((name): EntrySpec => ({ type: "txt", name: `${name}.txt` })),
		letter.map((name): EntrySpec => ({ type: "dotfile", name: `.${name}` })),
	];
}

function entryArb(depth: number): fc.Arbitrary<EntrySpec> {
	if (depth <= 0) return fc.oneof(...leafArbs());
	const dirArb: fc.Arbitrary<EntrySpec> = fc
		.tuple(letter, entriesArb(depth - 1))
		.map(([name, children]): EntrySpec => ({ type: "dir", name, children }));
	const nodeModulesArb: fc.Arbitrary<EntrySpec> = entriesArb(depth - 1).map(
		(children): EntrySpec => ({ type: "node_modules", name: "node_modules", children }),
	);
	return fc.oneof(...leafArbs(), dirArb, nodeModulesArb);
}

function entriesArb(depth: number): fc.Arbitrary<EntrySpec[]> {
	return fc.array(entryArb(depth), { minLength: 0, maxLength: 3 }).map((entries) => {
		// Keep at most one entry per name: two entries sharing a name (e.g. two
		// generated "a" directories) can't both be written to the same parent.
		const seen = new Set<string>();
		return entries.filter((entry) => {
			if (seen.has(entry.name)) return false;
			seen.add(entry.name);
			return true;
		});
	});
}

async function materialize(dirAbs: string, entries: EntrySpec[]): Promise<void> {
	for (const entry of entries) {
		const abs = path.join(dirAbs, entry.name);
		if (entry.type === "doc") {
			await fs.writeFile(abs, entry.body, "utf8");
		} else if (entry.type === "txt") {
			await fs.writeFile(abs, "not a doc\n", "utf8");
		} else if (entry.type === "dotfile") {
			await fs.writeFile(abs, "# hidden\n", "utf8");
		} else {
			await fs.mkdir(abs);
			await materialize(abs, entry.children);
		}
	}
}

function flattenTreeDocPaths(nodes: TreeNode[], out: string[] = []): string[] {
	for (const node of nodes) {
		if (!node.isDir) out.push(node.path);
		if (node.children) flattenTreeDocPaths(node.children, out);
	}
	return out;
}

async function mkTmpRoot(prefix: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), `mdxserve-prop-${prefix}`));
	return fs.realpath(dir);
}

async function rmTree(dirAbs: string): Promise<void> {
	await fs.rm(dirAbs, { recursive: true, force: true });
}

describe("schema faithfulness", () => {
	it(
		"search().results parses under its output schema, idempotently",
		async () => {
			await fc.assert(
				fc.asyncProperty(entriesArb(3), fc.string({ maxLength: 8 }), async (entries, query) => {
					const root = await mkTmpRoot("schema-");
					try {
						await materialize(root, entries);
						const rootInfo = { name: "docs", dir: root };
						const docCache = new DocCache();

						const resultsSchema = z.array(searchResultSchema);
						const searchService = new SearchService(docCache);
						const parsedResults = resultsSchema.parse(
							searchService.search([rootInfo], query).results,
						);
						expect(resultsSchema.parse(parsedResults)).toEqual(parsedResults);
					} finally {
						await rmTree(root);
					}
				}),
				{ numRuns: 15 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});

// --- searchDocs well-formedness + oracle ----------------------------------

const nonceWordArb = fc
	.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")), {
		minLength: 6,
		maxLength: 12,
	})
	.map((letters) => `zzqnonce${letters.join("")}`);

describe("searchDocs well-formedness + oracle", () => {
	it(
		"every result is inside a root, is a .md/.mdx doc from the tree, capped at 30, and a nonce word is found",
		async () => {
			await fc.assert(
				fc.asyncProperty(entriesArb(2), nonceWordArb, async (entries, nonce) => {
					const root = await mkTmpRoot("search-");
					try {
						await materialize(root, entries);
						const noncePath = path.join(root, "nonce-doc.md");
						await fs.writeFile(noncePath, `# Nonce\n\n${nonce} appears in this doc.\n`, "utf8");
						const rootInfo = { name: "docs", dir: root };
						const treeDocPaths = flattenTreeDocPaths(readTree(root));

						const searchService = new SearchService(new DocCache());
						const results = searchService.search([rootInfo], nonce).results;
						expect(results.length).toBeLessThanOrEqual(30);
						expect(results.some((result) => result.path === noncePath)).toBe(true);

						for (const result of results) {
							expect(result.path.startsWith(`${root}${path.sep}`) || result.path === root).toBe(
								true,
							);
							expect(/\.(md|mdx)$/i.test(result.path)).toBe(true);
							expect(treeDocPaths).toContain(result.path);
						}
					} finally {
						await rmTree(root);
					}
				}),
				{ numRuns: 15 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});

// Note: search now goes through SearchService, an instance-owned MiniSearch
// index rather than a module-level singleton, and each property run above
// builds a fresh instance over a fresh tmpdir root — so there's no shared
// index for stale entries to leak through between runs, or between this file
// and any other test file in the process.
