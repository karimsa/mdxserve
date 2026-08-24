import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { z } from "zod";
import { readListing } from "../../src/listing/folder.js";
import { readTree } from "../../src/listing/tree.js";
import { DocCache } from "../../src/docs/doc-cache.js";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import { folderListingSchema, treeNodeSchema } from "../../src/listing/controller.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext } from "../helpers/context.js";

const createCaller = createCallerFactory(appRouter);
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

/** Every directory in the generated tree, including the root and any `node_modules` dirs. */
function collectDirs(dirAbs: string, entries: EntrySpec[]): string[] {
	const dirs = [dirAbs];
	for (const entry of entries) {
		if (entry.type === "dir" || entry.type === "node_modules") {
			dirs.push(...collectDirs(path.join(dirAbs, entry.name), entry.children));
		}
	}
	return dirs;
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
		"readListing and readTree parse under their output schemas, idempotently",
		async () => {
			await fc.assert(
				fc.asyncProperty(entriesArb(3), async (entries) => {
					const root = await mkTmpRoot("schema-");
					try {
						await materialize(root, entries);
						const rootInfo = { name: "docs", dir: root };
						const docCache = new DocCache();

						for (const dirAbs of collectDirs(root, entries)) {
							const listing: Record<string, unknown> = {
								...readListing(dirAbs, rootInfo, docCache),
							};
							delete listing.kind;
							const parsedListing = folderListingSchema.parse(listing);
							expect(folderListingSchema.parse(parsedListing)).toEqual(parsedListing);

							const treeArraySchema = z.array(treeNodeSchema);
							const parsedTree = treeArraySchema.parse(readTree(dirAbs));
							expect(treeArraySchema.parse(parsedTree)).toEqual(parsedTree);
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

// --- getFolderListing normalization ---------------------------------------

describe("getFolderListing normalization", () => {
	it(
		"is a fixpoint, and p, p/, p/./, p/x/.. give deep-equal output",
		async () => {
			await fc.assert(
				fc.asyncProperty(entriesArb(2), async (entries) => {
					const root = await mkTmpRoot("normalize-");
					try {
						await materialize(root, entries);
						const caller = createCaller(makeContext(root, registry));

						for (const dirAbs of collectDirs(root, entries)) {
							const variants = [dirAbs, `${dirAbs}/`, `${dirAbs}/./`, `${dirAbs}/nonexistent-x/..`];
							const results = await Promise.all(
								variants.map((variant) => caller.getFolderListing({ path: variant })),
							);
							for (const result of results) expect(result).toEqual(results[0]);

							const refetched = await caller.getFolderListing({ path: results[0].path });
							expect(refetched).toEqual(results[0]);
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

// --- getDocTree / getFolderListing agreement ------------------------------

describe("getDocTree / getFolderListing agreement", () => {
	it(
		"per directory, the doc names from readListing match the non-dir node names from readTree",
		async () => {
			await fc.assert(
				fc.asyncProperty(entriesArb(2), async (entries) => {
					const root = await mkTmpRoot("agree-");
					try {
						await materialize(root, entries);
						const rootInfo = { name: "docs", dir: root };
						const docCache = new DocCache();

						for (const dirAbs of collectDirs(root, entries)) {
							const listingDocNames = readListing(dirAbs, rootInfo, docCache)
								.entries.filter((entry) => entry.isDoc)
								.map((entry) => entry.name)
								.sort();
							const treeDocNames = readTree(dirAbs)
								.filter((node) => !node.isDir)
								.map((node) => node.name)
								.sort();
							expect(treeDocNames).toEqual(listingDocNames);
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
