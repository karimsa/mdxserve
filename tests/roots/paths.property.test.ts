import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { resolveDirPath, resolveDocPath, resolveRoot } from "../../src/roots/paths.js";

const PROPERTY_TIMEOUT_MS = 30000;

let rootDir: string;
let outsideDir: string;

beforeAll(async () => {
	// Roots are realpaths in production; mirror that (see tests/roots/paths.test.ts).
	rootDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-paths-prop-root-")),
	);
	outsideDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-paths-prop-outside-")),
	);

	await fs.writeFile(path.join(rootDir, "doc.md"), "# Doc\n", "utf8");
	await fs.mkdir(path.join(rootDir, "sub"));
	await fs.writeFile(path.join(rootDir, "sub", "nested.md"), "# Nested\n", "utf8");
	// A dotfile-named directory, containing a doc, that should never resolve.
	await fs.mkdir(path.join(rootDir, ".hidden"));
	await fs.writeFile(path.join(rootDir, ".hidden", "doc.md"), "# Hidden\n", "utf8");
	// A directory inside the root that's really a symlink pointing outside it.
	await fs.symlink(outsideDir, path.join(rootDir, "escape"), "dir");
	await fs.writeFile(path.join(outsideDir, "secret.md"), "# Secret\n", "utf8");
	// A file inside the root that's a symlink whose target escapes the root.
	await fs.symlink(path.join(outsideDir, "secret.md"), path.join(rootDir, "leak.md"), "file");
});

afterAll(async () => {
	await fs.rm(rootDir, { recursive: true, force: true });
	await fs.rm(outsideDir, { recursive: true, force: true });
});

/**
 * A mix of legit nested docs (with some ".."-noise that cancels out to the
 * same target), dotfile-segment paths, and paths reached through an
 * escaping symlink — the categories `resolveDocPath` has to tell apart.
 */
function docCandidateArb(): fc.Arbitrary<string> {
	return fc.oneof(
		fc
			.array(fc.constantFrom("sub", "deeper", "more"), { minLength: 0, maxLength: 3 })
			.map((segments) =>
				path.join(rootDir, ...segments.flatMap((segment) => [segment, ".."]), "doc.md"),
			),
		fc.constant(path.join(rootDir, "sub", "nested.md")),
		fc.constant(path.join(rootDir, "sub", "..", "doc.md")),
		fc.constant(path.join(rootDir, ".hidden", "doc.md")),
		fc.constant(path.join(rootDir, "escape", "secret.md")),
		fc.constant(path.join(rootDir, "leak.md")),
		fc.constant(path.join(rootDir, "..", path.basename(outsideDir), "secret.md")),
	);
}

function dirCandidateArb(): fc.Arbitrary<string> {
	return fc.oneof(
		fc
			.array(fc.constantFrom("sub", "deeper", "more"), { minLength: 0, maxLength: 3 })
			.map((segments) =>
				path.join(rootDir, ...segments.flatMap((segment) => [segment, ".."]), "sub"),
			),
		fc.constant(path.join(rootDir, "sub")),
		fc.constant(path.join(rootDir, ".hidden")),
		fc.constant(path.join(rootDir, "escape")),
		fc.constant(path.join(rootDir, "..", path.basename(outsideDir))),
	);
}

describe("resolveDocPath — soundness", () => {
	it(
		"an ok result's realpath is always inside the root's realpath",
		async () => {
			await fc.assert(
				fc.asyncProperty(docCandidateArb(), async (candidate) => {
					const result = await resolveDocPath([rootDir], candidate);
					if (!result.ok) return;
					const realFile = await fs.realpath(result.abs);
					const relative = path.relative(rootDir, realFile);
					expect(relative.startsWith("..") || path.isAbsolute(relative)).toBe(false);
				}),
				{ numRuns: 25 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});

describe("resolveDirPath — soundness", () => {
	it(
		"an ok result's realpath is always inside the root's realpath",
		async () => {
			await fc.assert(
				fc.asyncProperty(dirCandidateArb(), async (candidate) => {
					const result = await resolveDirPath([rootDir], candidate);
					if (!result.ok) return;
					const realDir = await fs.realpath(result.abs);
					const relative = path.relative(rootDir, realDir);
					expect(relative.startsWith("..") || path.isAbsolute(relative)).toBe(false);
				}),
				{ numRuns: 25 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});

describe("resolveRoot — idempotence", () => {
	it("resolveRoot(resolveRoot(p).abs) agrees with resolveRoot(p)", () => {
		fc.assert(
			fc.property(
				fc.oneof(
					fc.constant(path.join(rootDir, "doc.md")),
					fc.constant(path.join(rootDir, "sub", "nested.md")),
					fc.constant(path.join(rootDir, "sub", "..", "doc.md")),
					fc.constant(outsideDir),
					fc
						.array(fc.constantFrom("a", "b", "c", ".."), { minLength: 0, maxLength: 5 })
						.map((segments) => path.join(rootDir, ...segments)),
				),
				(candidate) => {
					const first = resolveRoot([rootDir], candidate);
					if (!first) return;
					const second = resolveRoot([rootDir], first.abs);
					expect(second).toEqual(first);
				},
			),
		);
	});
});
