import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ListingService } from "../../src/listing/service.js";
import { DocCache } from "../../src/docs/doc-cache.js";
import { isServable } from "../../src/roots/servable.js";
import type { TreeNode } from "../../src/listing/tree.js";

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

async function mkTmpRoot(prefix: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), `mdxserve-listing-service-prop-${prefix}`));
	return fs.realpath(dir);
}

async function rmTree(dirAbs: string): Promise<void> {
	await fs.rm(dirAbs, { recursive: true, force: true });
}

/**
 * Simulate `readTree(dirAbs, maxDepth)`'s own depth pruning against an
 * already-computed tree from a larger `maxDepth`: a directory whose depth is
 * `>= maxDepth` is dropped entirely (and, transitively, everything under
 * it); files are never depth-limited on their own.
 */
function truncate(nodes: TreeNode[], maxDepth: number, depth = 0): TreeNode[] {
	const result: TreeNode[] = [];
	for (const node of nodes) {
		if (!node.isDir) {
			result.push(node);
			continue;
		}
		if (depth >= maxDepth) continue;
		const children = truncate(node.children ?? [], maxDepth, depth + 1);
		if (children.length === 0) continue;
		result.push({ ...node, children });
	}
	return result;
}

function assertWellOrdered(nodes: TreeNode[]): void {
	for (let index = 1; index < nodes.length; index++) {
		const previous = nodes[index - 1];
		const current = nodes[index];
		if (previous.isDir !== current.isDir) {
			expect(previous.isDir).toBe(true); // dirs before files
		} else {
			expect(
				previous.name.localeCompare(current.name, undefined, { sensitivity: "base" }),
			).toBeLessThanOrEqual(0);
		}
	}
	for (const node of nodes) {
		expect(isServable(node.name)).toBe(true);
		if (node.children) assertWellOrdered(node.children);
	}
}

describe("ListingService.docTree — depth truncation", () => {
	it(
		"docTree({maxDepth: n}) equals docTree({maxDepth: n+1}) with nodes deeper than n pruned",
		async () => {
			await fc.assert(
				fc.asyncProperty(entriesArb(3), fc.integer({ min: 0, max: 3 }), async (entries, n) => {
					const root = await mkTmpRoot("depth-");
					try {
						await materialize(root, entries);
						const service = new ListingService([{ name: "docs", dir: root }], new DocCache());
						const shallow = await service.docTree({ maxDepth: n });
						const deep = await service.docTree({ maxDepth: n + 1 });
						expect(shallow.kind).toBe("ok");
						expect(deep.kind).toBe("ok");
						if (shallow.kind !== "ok" || deep.kind !== "ok") return;
						expect(shallow.roots[0].nodes).toEqual(truncate(deep.roots[0].nodes, n));
					} finally {
						await rmTree(root);
					}
				}),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});

describe("ListingService.docTree — ordering and servability", () => {
	it(
		"every level is dirs-before-files in case-insensitive name order, and no non-servable name appears",
		async () => {
			await fc.assert(
				fc.asyncProperty(entriesArb(3), async (entries) => {
					const root = await mkTmpRoot("order-");
					try {
						await materialize(root, entries);
						const service = new ListingService([{ name: "docs", dir: root }], new DocCache());
						const result = await service.docTree({ maxDepth: 8 });
						expect(result.kind).toBe("ok");
						if (result.kind !== "ok") return;
						assertWellOrdered(result.roots[0].nodes);
					} finally {
						await rmTree(root);
					}
				}),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});

describe("ListingService.docTree — dirAbs", () => {
	it(
		"dirAbs is set iff a path was given",
		async () => {
			await fc.assert(
				fc.asyncProperty(entriesArb(2), fc.boolean(), async (entries, givePath) => {
					const root = await mkTmpRoot("dirabs-");
					try {
						await materialize(root, entries);
						const service = new ListingService([{ name: "docs", dir: root }], new DocCache());
						const result = await service.docTree(
							givePath ? { path: root, maxDepth: 8 } : { maxDepth: 8 },
						);
						expect(result.kind).toBe("ok");
						if (result.kind !== "ok") return;
						expect(result.dirAbs !== undefined).toBe(givePath);
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
