import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { TrashService } from "../../src/trash/service.js";

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
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), `mdxserve-prop-${prefix}`));
	return fs.realpath(dir);
}

async function rmTree(dirAbs: string): Promise<void> {
	await fs.rm(dirAbs, { recursive: true, force: true });
}

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
		const invalidSegment = rel.some(
			(segment) => segment.startsWith(".") || segment === "node_modules",
		);
		if (entry.type === "dir" || entry.type === "node_modules") {
			out.push({ abs, category: invalidSegment ? "invalid" : "directory" });
			out.push(...collectCandidates(abs, entry.children, rootAbs));
		} else {
			out.push({
				abs,
				category: invalidSegment || entry.type !== "doc" ? "invalid" : "validFile",
			});
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
	let index = 0;
	for (const item of full) {
		if (index < sub.length && sub[index] === item) index++;
	}
	return index === sub.length;
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
							.filter((candidate) => candidate.category === "validFile")
							.map((candidate) => candidate.abs);
						const others = candidates
							.filter((candidate) => candidate.category !== "validFile")
							.map((candidate) => candidate.abs);
						// Duplicate the first valid file (if any) so repeats are exercised.
						const paths = [...validFiles, ...validFiles.slice(0, 1), ...others];

						const spy = vi.fn(async () => {});
						const result = await new TrashService([{ name: "docs", dir: root }], spy).moveToTrash(
							paths,
						);
						const combined = [...result.deleted, ...result.failed.map((failure) => failure.path)];

						expect([...combined].sort()).toEqual([...paths].sort());
						expect(isSubsequence(result.deleted, paths)).toBe(true);
						expect(
							isSubsequence(
								result.failed.map((failure) => failure.path),
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
						const paths = candidates.map((candidate) => candidate.abs);
						const spy = vi.fn(async (_abs: string) => {});
						await new TrashService([{ name: "docs", dir: root }], spy).moveToTrash(paths);

						const realRoot = await fs.realpath(root);
						for (const call of spy.mock.calls) {
							const [abs] = call;
							const realDir = await fs.realpath(path.dirname(abs));
							const relReal = path.relative(realRoot, realDir);
							expect(relReal.startsWith("..") || path.isAbsolute(relReal)).toBe(false);

							const relSegments = path.relative(root, abs).split(path.sep);
							expect(
								relSegments.every(
									(segment) => !segment.startsWith(".") && segment !== "node_modules",
								),
							).toBe(true);
							expect(/\.mdx?$/i.test(abs)).toBe(true);
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
