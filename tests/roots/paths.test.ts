import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	expandHome,
	importResolves,
	resolveDirPath,
	resolveDocPath,
} from "../../src/roots/paths.js";

let rootDir: string;
let outsideDir: string;
let aliasDir: string;

beforeAll(async () => {
	// Roots are realpaths in production (index.ts realpaths them), so mirror that.
	rootDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-paths-test-root-")),
	);
	outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-paths-test-outside-"));

	await fs.writeFile(path.join(rootDir, "doc.md"), "# Doc\n", "utf8");
	await fs.writeFile(path.join(outsideDir, "secret.md"), "# Secret\n", "utf8");

	// A directory inside the root that's really a symlink pointing outside it.
	await fs.symlink(outsideDir, path.join(rootDir, "escape"), "dir");
	await fs.mkdir(path.join(rootDir, "sub"));
	// Symlinked docs: one whose target stays inside the root, one that escapes.
	await fs.symlink(path.join(rootDir, "doc.md"), path.join(rootDir, "sub", "alias.md"), "file");
	await fs.symlink(path.join(outsideDir, "secret.md"), path.join(rootDir, "leak.md"), "file");
	await fs.mkdir(path.join(rootDir, ".drafts"));
	for (const extension of ["md", "mdx"]) {
		const target = path.join(rootDir, ".drafts", `guide.${extension}`);
		await fs.writeFile(target, `# ${extension} guide\n`, "utf8");
		await fs.symlink(target, path.join(rootDir, `guide.${extension}`), "file");
	}
	await fs.symlink(path.join(rootDir, ".drafts"), path.join(rootDir, "drafts"), "dir");
	// A symlink alias of the root itself (like /tmp vs /private/tmp on macOS).
	aliasDir = path.join(outsideDir, "alias");
	await fs.symlink(rootDir, aliasDir, "dir");
	await fs.writeFile(path.join(rootDir, "Widget.tsx"), "export default () => null;\n", "utf8");
	await fs.mkdir(path.join(rootDir, "parts"));
	await fs.writeFile(path.join(rootDir, "parts", "index.ts"), "export {};\n", "utf8");
});

afterAll(async () => {
	await fs.rm(rootDir, { recursive: true, force: true });
	await fs.rm(outsideDir, { recursive: true, force: true });
});

describe("resolveDocPath with no roots", () => {
	it("resolves an absolute path with zero served roots", async () => {
		const abs = path.join(rootDir, "doc.md");
		const result = await resolveDocPath([], abs);
		expect(result).toMatchObject({ ok: true, abs });
	});

	it("still rejects a non-.md/.mdx file with zero served roots", async () => {
		const notMd = path.join(rootDir, "notes.txt");
		await fs.writeFile(notMd, "hi", "utf8");
		const result = await resolveDocPath([], notMd);
		expect(result.ok).toBe(false);
	});

	it("still rejects a path whose parent directory doesn't exist, with zero served roots", async () => {
		const result = await resolveDocPath([], path.join(rootDir, "nope", "doc.md"));
		expect(result.ok).toBe(false);
	});
});

describe("resolveDocPath with a root", () => {
	it("rejects a symlinked directory inside the root that points outside it", async () => {
		const result = await resolveDocPath([rootDir], path.join(rootDir, "escape", "secret.md"));
		expect(result.ok).toBe(false);
	});

	it("still accepts a plain file inside the root", async () => {
		const abs = path.join(rootDir, "doc.md");
		const result = await resolveDocPath([rootDir], abs);
		expect(result).toMatchObject({ ok: true, abs });
	});
});

describe("resolveDocPath with symlinked docs", () => {
	it.each(["md", "mdx"])(
		"keeps a visible %s alias to a hidden target in full mode but rejects it in restricted mode",
		async (extension) => {
			const alias = path.join(rootDir, `guide.${extension}`);
			expect(await resolveDocPath([rootDir], alias)).toMatchObject({ ok: true, abs: alias });
			expect((await resolveDocPath([rootDir], alias, true)).ok).toBe(false);
		},
	);

	it("accepts a symlinked doc whose target stays inside the root", async () => {
		const abs = path.join(rootDir, "sub", "alias.md");
		expect(await resolveDocPath([rootDir], abs)).toMatchObject({ ok: true, abs, root: rootDir });
	});

	it("rejects a symlinked doc whose target is outside the root", async () => {
		const result = await resolveDocPath([rootDir], path.join(rootDir, "leak.md"));
		expect(result.ok).toBe(false);
	});

	it("accepts a symlinked doc with no roots (nothing to be contained in)", async () => {
		const abs = path.join(rootDir, "leak.md");
		expect(await resolveDocPath([], abs)).toMatchObject({ ok: true, abs });
	});
});

describe("paths through a symlink alias of the root", () => {
	it("resolveDocPath accepts a doc reached via the alias and reports the real root", async () => {
		const result = await resolveDocPath([rootDir], path.join(aliasDir, "doc.md"));
		expect(result).toMatchObject({ ok: true, root: rootDir });
	});

	it("resolveDirPath accepts a directory reached via the alias", async () => {
		const result = await resolveDirPath([rootDir], path.join(aliasDir, "sub"));
		expect(result).toMatchObject({ ok: true, root: rootDir });
	});
});

describe("resolveDirPath", () => {
	it("keeps a visible directory alias to a hidden target in full mode but rejects it in restricted mode", async () => {
		const alias = path.join(rootDir, "drafts");
		expect(await resolveDirPath([rootDir], alias)).toMatchObject({ ok: true, abs: alias });
		expect((await resolveDirPath([rootDir], alias, true)).ok).toBe(false);
	});

	it("accepts a real directory inside a root", async () => {
		const abs = path.join(rootDir, "sub");
		expect(await resolveDirPath([rootDir], abs)).toMatchObject({ ok: true, abs, root: rootDir });
	});

	it("rejects a symlinked directory that points outside the root", async () => {
		const result = await resolveDirPath([rootDir], path.join(rootDir, "escape"));
		expect(result.ok).toBe(false);
	});

	it("rejects files, missing paths, and paths outside every root", async () => {
		for (const candidate of [
			path.join(rootDir, "doc.md"),
			path.join(rootDir, "nope"),
			outsideDir,
		]) {
			expect((await resolveDirPath([rootDir], candidate)).ok).toBe(false);
		}
	});
});

describe("importResolves", () => {
	it("resolves literal, extensionless, and directory-index specifiers like Vite", () => {
		const from = path.join(rootDir, "doc.md");
		expect(importResolves(from, "./Widget.tsx")).toBe(true);
		expect(importResolves(from, "./Widget")).toBe(true);
		expect(importResolves(from, "./parts")).toBe(true);
		expect(importResolves(from, "./Missing")).toBe(false);
		expect(importResolves(from, "./sub")).toBe(false);
	});
});

describe("expandHome", () => {
	const home = "/Users/someone";

	it("expands a bare ~ and a leading ~/", () => {
		expect(expandHome("~", home)).toBe(home);
		expect(expandHome("~/docs", home)).toBe(path.join(home, "docs"));
		expect(expandHome("~/", home)).toBe(home);
	});

	it("leaves ~user, a mid-path ~, and ordinary paths alone", () => {
		expect(expandHome("~bob/docs", home)).toBe("~bob/docs");
		expect(expandHome("./~/docs", home)).toBe("./~/docs");
		expect(expandHome("docs/~", home)).toBe("docs/~");
		expect(expandHome("/abs/docs", home)).toBe("/abs/docs");
		expect(expandHome("", home)).toBe("");
	});
});
