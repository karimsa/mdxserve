import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { z } from "zod";
import { readListing, readTree, isServable, type TreeNode } from "../src/listing.js";
import { search } from "../src/search.js";
import { moveDocsToTrash } from "../src/trash-docs.js";
import { spliceLines } from "../src/edit.js";
import { createCallerFactory } from "../src/api/trpc.js";
import { appRouter } from "../src/api/router.js";
import { folderListingSchema, treeNodeSchema, searchResultSchema } from "../src/api/schemas.js";
import type { RenderOutcome } from "../src/render.js";
import { fixtureRegistry as registry } from "./fixtures/registry.js";

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
		"readListing, readTree, and search().results all parse under their output schemas, idempotently",
		async () => {
			await fc.assert(
				fc.asyncProperty(entriesArb(3), fc.string({ maxLength: 8 }), async (entries, query) => {
					const root = await mkTmpRoot("schema-");
					try {
						await materialize(root, entries);
						const rootInfo = { name: "docs", dir: root };

						for (const dirAbs of collectDirs(root, entries)) {
							const listing: Record<string, unknown> = { ...readListing(dirAbs, rootInfo) };
							delete listing.kind;
							const parsedListing = folderListingSchema.parse(listing);
							expect(folderListingSchema.parse(parsedListing)).toEqual(parsedListing);

							const treeArraySchema = z.array(treeNodeSchema);
							const parsedTree = treeArraySchema.parse(readTree(dirAbs));
							expect(treeArraySchema.parse(parsedTree)).toEqual(parsedTree);
						}

						const resultsSchema = z.array(searchResultSchema);
						const parsedResults = resultsSchema.parse(search([rootInfo], query).results);
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

// --- moveDocsToTrash: partition + containment -----------------------------

type Candidate = { abs: string; category: "validFile" | "directory" | "invalid" };

/** Classify every generated entry: invalid if any root-relative segment is a
 * dotfile or "node_modules" (matching `isServable`), else a real directory or
 * a real trashable file. */
function collectCandidates(dirAbs: string, entries: EntrySpec[], rootAbs: string): Candidate[] {
	const out: Candidate[] = [];
	for (const entry of entries) {
		const abs = path.join(dirAbs, entry.name);
		const rel = path.relative(rootAbs, abs).split(path.sep);
		const invalidSegment = rel.some((segment) => !isServable(segment));
		if (entry.type === "dir" || entry.type === "node_modules") {
			out.push({ abs, category: invalidSegment ? "invalid" : "directory" });
			out.push(...collectCandidates(abs, entry.children, rootAbs));
		} else {
			out.push({ abs, category: invalidSegment ? "invalid" : "validFile" });
		}
	}
	return out;
}

async function buildTrashFixture(
	entries: EntrySpec[],
): Promise<{ root: string; outside: string; candidates: Candidate[] }> {
	const root = await mkTmpRoot("trash-root-");
	const outside = await mkTmpRoot("trash-outside-");
	await materialize(root, entries);
	await fs.writeFile(path.join(outside, "secret.md"), "# secret\n", "utf8");
	// A directory inside the root that's really a symlink pointing outside it.
	await fs.symlink(outside, path.join(root, "escape-link"), "dir");

	const candidates = collectCandidates(root, entries, root);
	candidates.push({ abs: path.join(root, "escape-link", "secret.md"), category: "invalid" });
	candidates.push({ abs: path.join(outside, "secret.md"), category: "invalid" });
	candidates.push({ abs: path.join(root, "does-not-exist.md"), category: "invalid" });

	return { root, outside, candidates };
}

function isSubsequence(sub: string[], full: string[]): boolean {
	let i = 0;
	for (const item of full) {
		if (i < sub.length && sub[i] === item) i++;
	}
	return i === sub.length;
}

describe("moveDocsToTrash partition", () => {
	it(
		"deleted + failed is a permutation of the input, in-order within each bucket, duplicates counted twice",
		async () => {
			await fc.assert(
				fc.asyncProperty(entriesArb(2), async (entries) => {
					const { root, outside, candidates } = await buildTrashFixture(entries);
					try {
						const validFiles = candidates
							.filter((c) => c.category === "validFile")
							.map((c) => c.abs);
						const others = candidates.filter((c) => c.category !== "validFile").map((c) => c.abs);
						// Duplicate the first valid file (if any) so repeats are exercised.
						const paths = [...validFiles, ...validFiles.slice(0, 1), ...others];

						const spy = vi.fn(async () => {});
						const result = await moveDocsToTrash([root], paths, spy);
						const combined = [...result.deleted, ...result.failed.map((f) => f.path)];

						expect([...combined].sort()).toEqual([...paths].sort());
						expect(isSubsequence(result.deleted, paths)).toBe(true);
						expect(
							isSubsequence(
								result.failed.map((f) => f.path),
								paths,
							),
						).toBe(true);
					} finally {
						await rmTree(root);
						await rmTree(outside);
					}
				}),
				{ numRuns: 15 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});

describe("moveDocsToTrash containment", () => {
	it(
		"every path handed to trashFile is a real, root-contained, all-servable file",
		async () => {
			await fc.assert(
				fc.asyncProperty(entriesArb(2), async (entries) => {
					const { root, outside, candidates } = await buildTrashFixture(entries);
					try {
						const paths = candidates.map((c) => c.abs);
						const spy = vi.fn(async (_abs: string) => {});
						await moveDocsToTrash([root], paths, spy);

						const realRoot = await fs.realpath(root);
						for (const call of spy.mock.calls) {
							const [abs] = call;
							const realDir = await fs.realpath(path.dirname(abs));
							const relReal = path.relative(realRoot, realDir);
							expect(relReal.startsWith("..") || path.isAbsolute(relReal)).toBe(false);

							const relSegments = path.relative(root, abs).split(path.sep);
							expect(relSegments.every(isServable)).toBe(true);
						}
					} finally {
						await rmTree(root);
						await rmTree(outside);
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
						const caller = createCaller({
							roots: [root],
							rootInfos: [{ name: "docs", dir: root }],
							registry,
							isLoopback: false,
						});

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

						const results = search([rootInfo], nonce).results;
						expect(results.length).toBeLessThanOrEqual(30);
						expect(results.some((r) => r.path === noncePath)).toBe(true);

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

						for (const dirAbs of collectDirs(root, entries)) {
							const listingDocNames = readListing(dirAbs, rootInfo)
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

// --- validateDoc render gating --------------------------------------------

const renderOutcomeArb: fc.Arbitrary<RenderOutcome> = fc.oneof(
	fc.constant<RenderOutcome>({ ok: true }),
	fc.string({ minLength: 1, maxLength: 20 }).map((message) => ({ ok: false as const, message })),
);

describe("validateDoc render gating", () => {
	it(
		"rendered is exactly ctx.isLoopback, and the render stub only runs when isLoopback",
		async () => {
			await fc.assert(
				fc.asyncProperty(fc.boolean(), renderOutcomeArb, async (isLoopback, outcome) => {
					const root = await mkTmpRoot("render-");
					try {
						const docPath = path.join(root, "doc.md");
						await fs.writeFile(docPath, "# Doc\n\nplain content.\n", "utf8");
						const render = vi.fn(async (): Promise<RenderOutcome> => outcome);
						const caller = createCaller({
							roots: [root],
							rootInfos: [{ name: "docs", dir: root }],
							registry,
							isLoopback,
							render,
						});

						const result = await caller.validateDoc({ path: docPath });
						expect(result.rendered).toBe(isLoopback);
						expect(render).toHaveBeenCalledTimes(isLoopback ? 1 : 0);
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

// Note: src/search.ts's MiniSearch index is a module-level singleton shared
// across the whole test file (and every other test file in this process).
// Each run above uses a fresh tmpdir root, so ids never collide across runs
// and stale entries from earlier runs are pruned by `sync()`'s cleanup pass —
// but if this file's search-dependent properties ever flake, it's most
// likely index staleness racing a concurrent test file, not a real bug in
// `search()` or its schema.

// --- saveDocSection / getDocSource ---------------------------------------

// Plain prose lines only, so every spliced file is valid MDX and the
// validation step never gets in the way of the properties below.
const proseLine = fc
	.array(fc.constantFrom("alpha", "beta", "gamma", "delta"), { minLength: 1, maxLength: 4 })
	.map((words) => words.join(" "));
const proseDoc = fc
	.array(proseLine, { minLength: 1, maxLength: 8 })
	.map((lines) => "# Title\n\n" + lines.join("\n") + "\n");
const replacementArb = fc
	.array(proseLine, { minLength: 0, maxLength: 3 })
	.map((lines) => lines.join("\n"));

/** A 1-indexed inclusive line range inside a doc of `lineCount` lines. */
function rangeArb(lineCount: number): fc.Arbitrary<{ startLine: number; endLine: number }> {
	return fc
		.tuple(fc.integer({ min: 1, max: lineCount }), fc.integer({ min: 1, max: lineCount }))
		.map(([first, second]) => ({
			startLine: Math.min(first, second),
			endLine: Math.max(first, second),
		}));
}

describe("saveDocSection / getDocSource properties", () => {
	it(
		"save then read equals the spliceLines oracle, and the returned mtime is the file's",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					proseDoc.chain((doc) =>
						fc.tuple(fc.constant(doc), rangeArb(doc.split("\n").length - 1), replacementArb),
					),
					async ([doc, range, replacement]) => {
						const root = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-save-prop-"));
						try {
							const abs = path.join(root, "doc.md");
							await fs.writeFile(abs, doc, "utf8");
							const caller = createCaller({
								roots: [root],
								rootInfos: [{ name: "docs", dir: root }],
								registry,
								isLoopback: false,
							});
							const before = await caller.getDocSource({ path: abs });
							const saved = await caller.saveDocSection({
								path: abs,
								startLine: range.startLine,
								endLine: range.endLine,
								mtime: before.mtime,
								markdown: replacement,
							});
							const oracle = spliceLines(doc, range.startLine, range.endLine, replacement);
							expect(oracle.ok).toBe(true);
							const after = await caller.getDocSource({ path: abs });
							expect(after.text).toBe(oracle.ok ? oracle.text : "");
							expect(after.mtime).toBe(saved.mtime);
							expect(saved.mtime).toBe((await fs.stat(abs)).mtimeMs);
						} finally {
							await fs.rm(root, { recursive: true, force: true });
						}
					},
				),
				{ numRuns: 25 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"a stale mtime never changes the file (invariance under rejected saves)",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					proseDoc.chain((doc) =>
						fc.tuple(fc.constant(doc), rangeArb(doc.split("\n").length - 1), replacementArb),
					),
					async ([doc, range, replacement]) => {
						const root = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-stale-prop-"));
						try {
							const abs = path.join(root, "doc.md");
							await fs.writeFile(abs, doc, "utf8");
							const caller = createCaller({
								roots: [root],
								rootInfos: [{ name: "docs", dir: root }],
								registry,
								isLoopback: false,
							});
							const before = await caller.getDocSource({ path: abs });
							await expect(
								caller.saveDocSection({
									path: abs,
									startLine: range.startLine,
									endLine: range.endLine,
									mtime: before.mtime - 1,
									markdown: replacement,
								}),
							).rejects.toMatchObject({ code: "CONFLICT" });
							const after = await caller.getDocSource({ path: abs });
							expect(after).toEqual(before);
						} finally {
							await fs.rm(root, { recursive: true, force: true });
						}
					},
				),
				{ numRuns: 25 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});
