import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { spliceLines } from "../../src/docs/edit.js";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext } from "../helpers/context.js";

const createCaller = createCallerFactory(appRouter);
const PROPERTY_TIMEOUT_MS = 30000;

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
							const caller = createCaller(makeContext(root, registry));
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
							const caller = createCaller(makeContext(root, registry));
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
