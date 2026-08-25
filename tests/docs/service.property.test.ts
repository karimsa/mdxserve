import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { spliceLines } from "../../src/docs/edit.js";
import { DocsService, versionOf } from "../../src/docs/service.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

const PROPERTY_TIMEOUT_MS = 30000;

const wordArb = fc.constantFrom("alpha", "beta", "gamma", "delta", "widget", "gadget");
const proseLineArb = fc
	.array(wordArb, { minLength: 1, maxLength: 5 })
	.map((words) => words.join(" "));
const eolArb = fc.constantFrom<"\n" | "\r\n">("\n", "\r\n");

/** A prose doc with a chosen EOL style and trailing-newline state. */
function docArb(minLines: number, maxLines: number) {
	return fc
		.tuple(
			fc.array(proseLineArb, { minLength: minLines, maxLength: maxLines }),
			eolArb,
			fc.boolean(),
		)
		.map(([lines, eol, trailingEol]) => ({
			lines,
			eol,
			trailingEol,
			text: lines.join(eol) + (trailingEol ? eol : ""),
		}));
}

/** A 1-indexed inclusive line range inside a doc of `lineCount` lines. */
function rangeArb(lineCount: number): fc.Arbitrary<{ startLine: number; endLine: number }> {
	return fc
		.tuple(fc.integer({ min: 1, max: lineCount }), fc.integer({ min: 1, max: lineCount }))
		.map(([first, second]) => ({
			startLine: Math.min(first, second),
			endLine: Math.max(first, second),
		}));
}

const replacementArb = fc
	.array(proseLineArb, { minLength: 0, maxLength: 3 })
	.map((lines) => lines.join("\n"));

async function mkTmpRoot(prefix: string): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), `mdxserve-docs-service-prop-${prefix}`));
}

describe("DocsService — save-then-read round trip", () => {
	it(
		"readSource after saveSection matches the spliceLines oracle, for either EOL style and trailing-newline state",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					docArb(2, 8).chain((doc) =>
						fc.tuple(fc.constant(doc), rangeArb(doc.lines.length), replacementArb),
					),
					async ([doc, range, replacement]) => {
						const root = await mkTmpRoot("roundtrip-");
						try {
							const abs = path.join(root, "doc.md");
							await fs.writeFile(abs, doc.text, "utf8");
							const service = new DocsService([{ name: "docs", dir: root }], registry);

							const saved = await service.saveSection({
								path: abs,
								startLine: range.startLine,
								endLine: range.endLine,
								version: versionOf(doc.text),
								markdown: replacement,
							});
							expect(saved.kind).toBe("ok");

							const oracle = spliceLines(doc.text, range.startLine, range.endLine, replacement);
							expect(oracle.ok).toBe(true);
							if (!oracle.ok) return;

							const read = await service.readSource(abs);
							expect(read.kind).toBe("ok");
							if (read.kind !== "ok") return;
							expect(read.source.text).toBe(oracle.text);
							expect(read.source.version).toBe(versionOf(read.source.text));
						} finally {
							await fs.rm(root, { recursive: true, force: true });
						}
					},
				),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});

describe("DocsService — rejected saves leave the file untouched", () => {
	it(
		"a stale version, an out-of-range line range, and invalid markdown all leave the file byte-identical, with no leftover .*.mdxserve-tmp file",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					docArb(2, 6),
					fc.constantFrom("stale", "out-of-range", "invalid-doc"),
					async (doc, mode) => {
						const root = await mkTmpRoot("reject-");
						try {
							const abs = path.join(root, "doc.md");
							await fs.writeFile(abs, doc.text, "utf8");
							const service = new DocsService([{ name: "docs", dir: root }], registry);

							const input =
								mode === "stale"
									? {
											path: abs,
											startLine: 1,
											endLine: 1,
											version: versionOf(`${doc.text}-drifted`),
											markdown: "changed",
										}
									: mode === "out-of-range"
										? {
												path: abs,
												startLine: 1,
												endLine: doc.lines.length + 50,
												version: versionOf(doc.text),
												markdown: "changed",
											}
										: {
												path: abs,
												startLine: 1,
												endLine: 1,
												version: versionOf(doc.text),
												markdown: "<UnknownComponent />",
											};

							const result = await service.saveSection(input);
							expect(result.kind).not.toBe("ok");

							const after = await fs.readFile(abs);
							expect(after.equals(Buffer.from(doc.text, "utf8"))).toBe(true);

							const dirEntries = await fs.readdir(root);
							expect(
								dirEntries.some((name) => name.startsWith(".") && name.endsWith(".mdxserve-tmp")),
							).toBe(false);
						} finally {
							await fs.rm(root, { recursive: true, force: true });
						}
					},
				),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});

describe("DocsService — concurrent saves", () => {
	it(
		"two concurrent saves on one instance with the same original version: exactly one ok, the other stale",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					docArb(2, 6),
					replacementArb,
					replacementArb,
					async (doc, replacementA, replacementB) => {
						// A replacement identical to line 1 leaves the bytes — and so the
						// version — unchanged, and the second save is then correctly `ok`
						// too. That no-op case is covered in service.test.ts; here we want
						// the write that lands first to actually move the version.
						fc.pre(replacementA !== doc.lines[0] && replacementB !== doc.lines[0]);
						const root = await mkTmpRoot("concurrent-");
						try {
							const abs = path.join(root, "doc.md");
							await fs.writeFile(abs, doc.text, "utf8");
							const service = new DocsService([{ name: "docs", dir: root }], registry);

							const [resultA, resultB] = await Promise.all([
								service.saveSection({
									path: abs,
									startLine: 1,
									endLine: 1,
									version: versionOf(doc.text),
									markdown: replacementA,
								}),
								service.saveSection({
									path: abs,
									startLine: 1,
									endLine: 1,
									version: versionOf(doc.text),
									markdown: replacementB,
								}),
							]);

							expect([resultA.kind, resultB.kind].sort()).toEqual(["ok", "stale"]);
						} finally {
							await fs.rm(root, { recursive: true, force: true });
						}
					},
				),
				{ numRuns: 15 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});
