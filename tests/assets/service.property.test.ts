import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AssetsService } from "../../src/assets/service.js";

let base: string;
let root: string;
let outside: string;

/** Names the generated paths are built from: files, dirs, links out, hidden names and `..`. */
const SEGMENTS = [
	"..",
	".",
	"img",
	"shot.png",
	"guide.md",
	"notes.mdx",
	".hidden",
	"node_modules",
	".git",
	"config",
	".env",
	"key.pem",
	"link-out",
	"file-link-out.png",
	"doc-link.png",
	"hidden-link.png",
	"outside",
	"secret.png",
	"root",
];

beforeAll(async () => {
	base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "mdxserve-assets-prop-")));
	root = path.join(base, "root");
	outside = path.join(base, "outside");
	for (const dir of ["img", ".hidden", "node_modules", ".git", "img/.hidden"]) {
		await fsp.mkdir(path.join(root, dir), { recursive: true });
	}
	await fsp.mkdir(outside, { recursive: true });
	for (const file of [
		"shot.png",
		"img/shot.png",
		"img/.hidden/shot.png",
		".hidden/shot.png",
		"node_modules/shot.png",
		".git/config",
		".env",
		"key.pem",
		"guide.md",
		"img/notes.mdx",
	]) {
		await fsp.writeFile(path.join(root, file), file);
	}
	await fsp.writeFile(path.join(outside, "secret.png"), "secret");
	await fsp.writeFile(path.join(outside, "guide.md"), "# Outside\n");
	await fsp.symlink(outside, path.join(root, "link-out"), "dir");
	await fsp.symlink(path.join(outside, "secret.png"), path.join(root, "img", "file-link-out.png"));
	await fsp.symlink(path.join(root, "guide.md"), path.join(root, "doc-link.png"));
	await fsp.symlink(path.join(root, ".hidden", "shot.png"), path.join(root, "hidden-link.png"));
});

afterAll(async () => {
	await fsp.rm(base, { recursive: true, force: true });
});

function inside(parent: string, child: string): boolean {
	const relative = path.relative(parent, child);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

const DENIED = (segment: string) =>
	segment === ".git" ||
	segment === ".env" ||
	segment.startsWith(".env.") ||
	segment.endsWith(".pem");

describe("AssetsService.locate properties", () => {
	it("only ever finds a non-document regular file whose real path stays in the root", async () => {
		const segmentsArb = fc.array(fc.constantFrom(...SEGMENTS), { minLength: 1, maxLength: 6 });
		let found = 0;
		await fc.assert(
			fc.asyncProperty(segmentsArb, fc.boolean(), async (segments, publicOnly) => {
				const input = `${root}/${segments.join("/")}`;
				const located = await new AssetsService([{ name: "root", dir: root }]).locate(
					input,
					publicOnly,
				);
				let real: string | null = null;
				try {
					// The native call, as the service makes. Node's own implementation disagrees with it
					// on macOS for `..` after a symlink to a file (`hidden-link.png/../shot.png`).
					real = fs.realpathSync.native(input);
				} catch {
					real = null;
				}
				if (located.kind !== "ok") return;
				found += 1;

				expect(real).toBe(located.abs);
				expect(inside(root, located.abs)).toBe(true);
				expect(fs.statSync(located.abs).isFile()).toBe(true);
				expect(located.abs).not.toMatch(/\.mdx?$/i);
				expect(input).not.toMatch(/\.mdx?$/i);
				const realSegments = path.relative(root, located.abs).split(path.sep);
				expect(realSegments.some(DENIED)).toBe(false);
				if (publicOnly) {
					expect(realSegments.some((segment) => segment.startsWith("."))).toBe(false);
					expect(realSegments).not.toContain("node_modules");
					const asked = path.relative(root, path.resolve(input)).split(path.sep);
					expect(asked.some((segment) => segment.startsWith(".") && segment !== "..")).toBe(false);
				}
				expect(fs.readFileSync(located.abs, "utf8")).not.toBe("secret");
			}),
			{ numRuns: 400 },
		);
		// The generator reaches servable files too, so the checks above ran.
		expect(found).toBeGreaterThan(0);
	});

	it("never finds anything whose real path is outside the root", async () => {
		const segmentsArb = fc.array(fc.constantFrom(...SEGMENTS), { minLength: 1, maxLength: 6 });
		await fc.assert(
			fc.asyncProperty(segmentsArb, async (segments) => {
				const input = `${root}/${segments.join("/")}`;
				let real: string;
				try {
					real = fs.realpathSync(input);
				} catch {
					return;
				}
				if (inside(root, real)) return;
				const located = await new AssetsService([{ name: "root", dir: root }]).locate(input, false);
				expect(located.kind).toBe("not-found");
			}),
			{ numRuns: 300 },
		);
	});
});
