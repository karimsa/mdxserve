import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { DocCache } from "../../src/docs/doc-cache.js";

const PROPERTY_TIMEOUT_MS = 30000;

let fixtureDir: string;
let fileCounter = 0;

beforeAll(async () => {
	fixtureDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-doc-cache-prop-")),
	);
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
});

const wordArb = fc.constantFrom("alpha", "beta", "gamma", "delta", "widget", "gadget");
const lineArb = fc.array(wordArb, { minLength: 0, maxLength: 6 }).map((words) => words.join(" "));
const linesArb = fc.array(lineArb, { minLength: 1, maxLength: 12 });
const eolArb = fc.constantFrom<"\n" | "\r\n">("\n", "\r\n");

async function writeFixture(
	lines: string[],
	eol: "\n" | "\r\n",
): Promise<{ abs: string; content: string; mtime: number }> {
	const abs = path.join(fixtureDir, `doc-${fileCounter++}.md`);
	const content = lines.join(eol);
	await fs.writeFile(abs, content, "utf8");
	const stat = await fs.stat(abs);
	return { abs, content, mtime: stat.mtimeMs };
}

describe("DocCache.read — content reproduction", () => {
	it(
		"lines rejoin (by the file's own EOL) to reproduce the full content, for content well under 64 KiB",
		async () => {
			await fc.assert(
				fc.asyncProperty(linesArb, eolArb, async (lines, eol) => {
					const { abs, content, mtime } = await writeFixture(lines, eol);
					const doc = new DocCache().read(abs, mtime);
					expect(doc.lines.join(eol)).toBe(content);
				}),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it("truncates to exactly the first 64 KiB for a larger file", async () => {
		const abs = path.join(fixtureDir, "huge.md");
		const bigContent = "a".repeat(70_000);
		await fs.writeFile(abs, bigContent, "utf8");
		const stat = await fs.stat(abs);
		const doc = new DocCache().read(abs, stat.mtimeMs);
		const rejoined = doc.lines.join("\n");
		expect(rejoined.length).toBe(64 * 1024);
		expect(rejoined).toBe(bigContent.slice(0, 64 * 1024));
	});
});

describe("DocCache.read — caching by (path, mtime)", () => {
	it(
		"the same (path, mtime) returns the cached document even if disk bytes change",
		async () => {
			await fc.assert(
				fc.asyncProperty(linesArb, eolArb, async (lines, eol) => {
					const { abs, mtime } = await writeFixture(lines, eol);
					const cache = new DocCache();
					const first = cache.read(abs, mtime);
					await fs.writeFile(abs, "changed on disk", "utf8");
					const second = cache.read(abs, mtime);
					expect(second).toEqual(first);
				}),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"a new mtime returns the changed document",
		async () => {
			await fc.assert(
				fc.asyncProperty(linesArb, eolArb, async (lines, eol) => {
					const { abs, mtime } = await writeFixture(lines, eol);
					const cache = new DocCache();
					cache.read(abs, mtime);
					await fs.writeFile(abs, "changed on disk", "utf8");
					const changed = cache.read(abs, mtime + 1);
					expect(changed.lines.join("\n")).toBe("changed on disk");
				}),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});

describe("DocCache.read — fresh vs warmed cache agreement", () => {
	it(
		"a cache warmed on unrelated files returns the same value as a fresh cache for the target file",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					linesArb,
					eolArb,
					fc.array(fc.tuple(linesArb, eolArb), { minLength: 0, maxLength: 3 }),
					async (targetLines, targetEol, warmups) => {
						const target = await writeFixture(targetLines, targetEol);
						const warmed = new DocCache();
						for (const [lines, eol] of warmups) {
							const { abs, mtime } = await writeFixture(lines, eol);
							warmed.read(abs, mtime);
						}
						const warmedResult = warmed.read(target.abs, target.mtime);
						const freshResult = new DocCache().read(target.abs, target.mtime);
						expect(warmedResult).toEqual(freshResult);
					},
				),
				{ numRuns: 15 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});
