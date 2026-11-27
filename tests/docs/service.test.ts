import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocsService, versionOf, MAX_SOURCE_BYTES } from "../../src/docs/service.js";
import { RootsService } from "../../src/roots/service.js";
import { ValidationService } from "../../src/validation/service.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

const ORIGINAL = "# Title\n\nline three\n\nline five\n";

let root: string;
let outside: string;
let abs: string;
let service: DocsService;

beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-docs-service-")));
	outside = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-docs-service-outside-")),
	);
	abs = path.join(root, "doc.md");
	await fs.writeFile(abs, ORIGINAL, "utf8");
	service = new DocsService(new RootsService(root, os.homedir(), [root]), registry);
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
	await fs.rm(outside, { recursive: true, force: true });
});

/** Read the doc's current version the way a client would. */
async function currentVersion(): Promise<string> {
	const read = await service.readSource(abs);
	if (read.kind !== "ok") throw new Error(`expected ok, got ${read.kind}`);
	return read.source.version;
}

describe("DocsService source parsing", () => {
	it("parses static metadata without evaluating document code", () => {
		const source =
			'---\ntitle: Public title\n---\nexport const title = (() => { throw new Error("must not run"); })();';
		expect(service.parseMetadata(source)).toEqual({
			metadata: { title: "Public title", openGraph: [] },
			diagnostics: [],
		});
	});

	it("reports invalid and truncated metadata without exposing partial values", () => {
		const invalid = service.parseMetadata("---\ntitle: Valid\ncanonical: /relative\n---\n");
		expect(invalid.metadata).toEqual({ openGraph: [] });
		expect(invalid.diagnostics).not.toHaveLength(0);
		const truncated = service.parseMetadata("---\ntitle: Partial", true);
		expect(truncated.metadata).toEqual({ openGraph: [] });
		expect(truncated.diagnostics[0]?.message).toContain("64 KiB");
	});

	it("locates only leading YAML and preserves its original value", () => {
		expect(service.leadingFrontmatter("---\r\ntitle: 'Public title'\r\n---\r\nBody")).toEqual({
			value: "title: 'Public title'",
			startLine: 2,
			endLine: 3,
		});
		expect(service.leadingFrontmatter("Body\n---\ntitle: Later\n---")).toBeUndefined();
	});
});

describe("DocsService.readSource", () => {
	it("returns the raw on-disk text with a version token for those bytes", async () => {
		const result = await service.readSource(abs);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.source.text).toBe(ORIGINAL);
		expect(result.source.version).toBe(versionOf(ORIGINAL));
	});

	it("reports a path outside every root as not-found", async () => {
		const secret = path.join(outside, "secret.md");
		await fs.writeFile(secret, "# Secret\n", "utf8");
		expect((await service.readSource(secret)).kind).toBe("not-found");
	});

	it("reports a missing file as not-found", async () => {
		expect((await service.readSource(path.join(root, "gone.md"))).kind).toBe("not-found");
	});

	it("refuses a file over the editor size cap, reporting its size", async () => {
		const huge = path.join(root, "huge.md");
		const body = "x".repeat(MAX_SOURCE_BYTES + 1);
		await fs.writeFile(huge, body, "utf8");
		const result = await service.readSource(huge);
		expect(result.kind).toBe("too-large");
		if (result.kind !== "too-large") return;
		expect(result.size).toBe(body.length);
	});
});

describe("DocsService.readMetadata", () => {
	it("reports a file removed after path resolution as not-found", async () => {
		const actualOpen = fs.open.bind(fs);
		const openSpy = vi.spyOn(fs, "open").mockImplementation(async (filePath, flags, mode) => {
			if (filePath === abs) await fs.unlink(abs);
			return actualOpen(filePath, flags, mode);
		});
		try {
			expect(await service.readMetadata(abs)).toEqual({
				kind: "not-found",
				message: `${abs} not found`,
			});
		} finally {
			openSpy.mockRestore();
		}
	});

	it.each([
		["EACCES", "not-found"],
		["EIO", "error"],
	] as const)("closes the handle when reading fails with %s", async (code, outcome) => {
		const actualOpen = fs.open.bind(fs);
		let closeSpy: ReturnType<typeof vi.spyOn> | undefined;
		const openSpy = vi.spyOn(fs, "open").mockImplementation(async (filePath, flags, mode) => {
			const handle = await actualOpen(filePath, flags, mode);
			if (filePath === abs) {
				vi.spyOn(handle, "read").mockRejectedValue(Object.assign(new Error(code), { code }));
				closeSpy = vi.spyOn(handle, "close");
			}
			return handle;
		});
		try {
			if (outcome === "not-found") {
				expect(await service.readMetadata(abs)).toEqual({
					kind: "not-found",
					message: `${abs} not found`,
				});
			} else {
				await expect(service.readMetadata(abs)).rejects.toMatchObject({ code });
			}
			expect(closeSpy).toHaveBeenCalledOnce();
		} finally {
			openSpy.mockRestore();
		}
	});

	it.each([
		["metadata", "---\ntitle: Sparse document\n---\n", { title: "Sparse document", openGraph: [] }],
		["plain body", "# Body\n", { openGraph: [] }],
	])("reads a bounded prefix of a sparse document with %s", async (_name, source, metadata) => {
		const large = path.join(root, "sparse.md");
		await fs.writeFile(large, source as string);
		await fs.truncate(large, 1024 * 1024 * 1024);
		const actualOpen = fs.open.bind(fs);
		const actualReadFile = fs.readFile.bind(fs);
		const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation((...arguments_) => {
			if (arguments_[0] === large) throw new Error("Metadata must not read the entire file");
			return actualReadFile(...arguments_);
		});
		const readSpies: ReturnType<typeof vi.spyOn>[] = [];
		const openSpy = vi.spyOn(fs, "open").mockImplementation(async (filePath, flags, mode) => {
			const handle = await actualOpen(filePath, flags, mode);
			readSpies.push(vi.spyOn(handle, "read"));
			return handle;
		});
		try {
			expect(await service.readMetadata(large)).toEqual({
				kind: "ok",
				metadata,
				diagnostics: [],
			});
			expect(readSpies).toHaveLength(1);
			const reads = await Promise.all(
				readSpies.flatMap((spy) =>
					spy.mock.results.map((result: { value: Promise<{ bytesRead: number }> }) => result.value),
				),
			);
			expect(reads.reduce((total, read) => total + read.bytesRead, 0)).toBeLessThanOrEqual(
				64 * 1024 + 33,
			);
		} finally {
			openSpy.mockRestore();
			readFileSpy.mockRestore();
		}
	});

	it("reads metadata above the editor limit while readSource keeps its cap", async () => {
		const large = path.join(root, "large.md");
		await fs.writeFile(large, `---\ntitle: Large document\n---\n${"x".repeat(MAX_SOURCE_BYTES)}`);
		expect((await service.readSource(large)).kind).toBe("too-large");
		expect(await service.readMetadata(large)).toEqual({
			kind: "ok",
			metadata: { title: "Large document", openGraph: [] },
			diagnostics: [],
		});
	});

	it("warns when multibyte YAML exceeds the byte limit", async () => {
		const large = path.join(root, "multibyte.md");
		await fs.writeFile(large, `---\ntitle: ${"é".repeat(33_000)}\n---`);
		const result = await service.readMetadata(large);
		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.metadata).toEqual({ openGraph: [] });
		expect(result.diagnostics[0]?.message).toContain("64 KiB");
	});

	it("applies root containment and public path rules", async () => {
		const outsideFile = path.join(outside, "secret.md");
		const hiddenFile = path.join(root, ".hidden.md");
		await fs.writeFile(outsideFile, "---\ntitle: Secret\n---\n");
		await fs.writeFile(hiddenFile, "---\ntitle: Hidden\n---\n");
		await fs.symlink(outsideFile, path.join(root, "linked.md"));
		expect((await service.readMetadata(outsideFile)).kind).toBe("not-found");
		expect((await service.readMetadata(path.join(root, "linked.md"), true)).kind).toBe("not-found");
		expect((await service.readMetadata(hiddenFile, true)).kind).toBe("not-found");
		expect((await service.readMetadata(hiddenFile)).kind).toBe("not-found");
		expect((await service.readMetadata(abs, true)).kind).toBe("ok");
	});
});

describe("DocsService.readNodeSource", () => {
	it("returns the lines of a section, with the version of the bytes they came from", async () => {
		const result = await service.readNodeSource(abs, "title");
		expect(result).toEqual({
			kind: "ok",
			markdown: "# Title\n\nline three\n\nline five",
			version: versionOf(ORIGINAL),
		});
	});

	it("returns the lines of a mermaid block and of a builtin block by their ids", async () => {
		const file = path.join(root, "blocks.md");
		const source =
			'# Title\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n<Callout tone="tip">Hi</Callout>\n';
		await fs.writeFile(file, source);
		expect(await service.readNodeSource(file, "title>~mermaid-1")).toMatchObject({
			kind: "ok",
			markdown: "```mermaid\nflowchart TD\n  A --> B\n```",
		});
		expect(await service.readNodeSource(file, "title>~callout-1")).toMatchObject({
			kind: "ok",
			markdown: '<Callout tone="tip">Hi</Callout>',
		});
	});

	it("returns the lines of a tab, and of a heading inside it", async () => {
		const file = path.join(root, "tabs.md");
		const source =
			'# Doc\n\n<Tabs id="t">\n  <Tab label="One">\n    ## Inner\n\n    one\n  </Tab>\n</Tabs>\n';
		await fs.writeFile(file, source);
		expect(await service.readNodeSource(file, "t>one")).toMatchObject({
			kind: "ok",
			markdown: '  <Tab label="One">\n    ## Inner\n\n    one\n  </Tab>',
		});
		expect(await service.readNodeSource(file, "inner")).toMatchObject({
			kind: "ok",
			markdown: "    ## Inner\n\n    one",
		});
	});

	it("leaves out the frontmatter and joins lines with a newline whatever the file uses", async () => {
		const file = path.join(root, "crlf.md");
		await fs.writeFile(file, "---\r\ntitle: x\r\n---\r\n# Doc\r\n\r\ntext\r\n");
		expect(await service.readNodeSource(file, "doc")).toMatchObject({
			kind: "ok",
			markdown: "# Doc\n\ntext",
		});
	});

	it("reports an id with no range, and a path outside every root, as not-found", async () => {
		expect((await service.readNodeSource(abs, "no-such-node")).kind).toBe("not-found");
		const secret = path.join(outside, "secret.md");
		await fs.writeFile(secret, "# Secret\n", "utf8");
		expect((await service.readNodeSource(secret, "secret")).kind).toBe("not-found");
	});

	it("applies public path rules and the size cap", async () => {
		const hidden = path.join(root, ".hidden.md");
		await fs.writeFile(hidden, "# Hidden\n");
		expect((await service.readNodeSource(hidden, "hidden", true)).kind).toBe("not-found");
		const huge = path.join(root, "huge.md");
		await fs.writeFile(huge, "x".repeat(MAX_SOURCE_BYTES + 1));
		expect(await service.readNodeSource(huge, "x")).toEqual({ kind: "too-large" });
	});
});

describe("DocsService.saveNode", () => {
	it.each(["md", "mdx"])(
		"preserves frontmatter bytes while saving a .%s body section",
		async (extension) => {
			const file = path.join(root, `metadata.${extension}`);
			const frontmatter =
				"---\r\ntitle: 'Public title'\r\n# Keep this comment\r\nopenGraph:\r\n  - property: og:title\r\n    content: Public title\r\n---\r\n";
			const source = `${frontmatter}\r\n# Heading\r\n\r\nOriginal body.\r\n`;
			await fs.writeFile(file, source);
			const result = await service.saveNode({
				path: file,
				id: "heading",
				version: versionOf(source),
				markdown: "# Heading\n\nChanged body.",
			});
			expect(result.kind).toBe("ok");
			const saved = await fs.readFile(file, "utf8");
			expect(saved).toBe(source.replace("Original body.", "Changed body."));
		},
	);

	it.each([".md", ".mdx"])(
		"saves an edited Mermaid block in %s with the normal version guard",
		async (extension) => {
			const file = path.join(root, `diagram${extension}`);
			const source = "# Title\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nline five\n";
			await fs.writeFile(file, source);
			const markdown = "```mermaid\nerDiagram\n CUSTOMER ||--o{ ORDER : places\n```";
			const saved = await service.saveNode({
				path: file,
				id: "title>~mermaid-1",
				version: versionOf(source),
				markdown,
			});
			expect(saved.kind).toBe("ok");
			const expected = `# Title\n\n${markdown}\n\nline five\n`;
			expect(await fs.readFile(file, "utf8")).toBe(expected);
			const stale = await service.saveNode({
				path: file,
				id: "title>~mermaid-1",
				version: versionOf(source),
				markdown: "stale",
			});
			expect(stale.kind).toBe("stale");
			expect(await fs.readFile(file, "utf8")).toBe(expected);
		},
	);

	it("saves an edited builtin block by its id and leaves its neighbours alone", async () => {
		const source = '# Title\n\nintro\n\n<Callout tone="tip">Hi</Callout>\n\noutro\n';
		await fs.writeFile(abs, source);
		const result = await service.saveNode({
			path: abs,
			id: "title>~callout-1",
			version: versionOf(source),
			markdown: '<Callout tone="warn">Careful</Callout>',
		});
		expect(result.kind).toBe("ok");
		expect(await fs.readFile(abs, "utf8")).toBe(
			'# Title\n\nintro\n\n<Callout tone="warn">Careful</Callout>\n\noutro\n',
		);
	});

	it("replaces exactly the node's lines and returns the new version", async () => {
		const result = await service.saveNode({
			path: abs,
			id: "title",
			version: versionOf(ORIGINAL),
			markdown: "# Title\n\nchanged line\n\nline five",
		});
		const written = "# Title\n\nchanged line\n\nline five\n";
		expect(result).toEqual({ kind: "ok", version: versionOf(written) });
		expect(await fs.readFile(abs, "utf8")).toBe(written);
	});

	it("keeps the blank lines that separate a node from the next one", async () => {
		const source = "# Title\n\nintro\n\n## One\n\nbody\n\n## Two\n\nmore\n";
		await fs.writeFile(abs, source);
		const result = await service.saveNode({
			path: abs,
			id: "one",
			version: versionOf(source),
			markdown: "## One\n\nedited",
		});
		expect(result.kind).toBe("ok");
		expect(await fs.readFile(abs, "utf8")).toBe(
			"# Title\n\nintro\n\n## One\n\nedited\n\n## Two\n\nmore\n",
		);
	});

	it("returns a version the next save can immediately use", async () => {
		const first = await service.saveNode({
			path: abs,
			id: "title",
			version: versionOf(ORIGINAL),
			markdown: "# Title\n\nfirst edit",
		});
		expect(first.kind).toBe("ok");
		if (first.kind !== "ok") return;

		const second = await service.saveNode({
			path: abs,
			id: "title",
			version: first.version,
			markdown: "# Title\n\nsecond edit",
		});
		expect(second.kind).toBe("ok");
		expect(await fs.readFile(abs, "utf8")).toBe("# Title\n\nsecond edit\n");
	});

	it("rejects a version that no longer matches the file, handing back the current one", async () => {
		await fs.writeFile(abs, "# Title\n\nsomeone else wrote this\n", "utf8");
		const result = await service.saveNode({
			path: abs,
			id: "title",
			version: versionOf(ORIGINAL),
			markdown: "my edit",
		});
		expect(result).toEqual({ kind: "stale", version: await currentVersion() });
		expect(await fs.readFile(abs, "utf8")).toBe("# Title\n\nsomeone else wrote this\n");
	});

	it("checks the version before looking the id up", async () => {
		await fs.writeFile(abs, "# Other\n\nnow there is no title\n", "utf8");
		const result = await service.saveNode({
			path: abs,
			id: "title",
			version: versionOf(ORIGINAL),
			markdown: "my edit",
		});
		expect(result).toEqual({ kind: "stale", version: await currentVersion() });
	});

	it("reports an unknown id as not-found, without writing", async () => {
		const result = await service.saveNode({
			path: abs,
			id: "no-such-node",
			version: versionOf(ORIGINAL),
			markdown: "my edit",
		});
		expect(result.kind).toBe("not-found");
		expect(await fs.readFile(abs, "utf8")).toBe(ORIGINAL);
	});

	it("catches a change an mtime check would miss, because it compares bytes", async () => {
		// Rewrite the file with a preserved mtime — exactly what a coarse
		// timestamp looks like from the service's side.
		const { atime, mtime } = await fs.stat(abs);
		await fs.writeFile(abs, "# Title\n\ndifferent content\n", "utf8");
		await fs.utimes(abs, atime, mtime);

		const result = await service.saveNode({
			path: abs,
			id: "title",
			version: versionOf(ORIGINAL),
			markdown: "my edit",
		});
		expect(result.kind).toBe("stale");
	});

	it("accepts a save when the file was edited back to the bytes it was read at", async () => {
		await fs.writeFile(abs, "# Title\n\nbriefly different\n", "utf8");
		await fs.writeFile(abs, ORIGINAL, "utf8");
		const result = await service.saveNode({
			path: abs,
			id: "title",
			version: versionOf(ORIGINAL),
			markdown: "# Title\n\nmy edit",
		});
		expect(result.kind).toBe("ok");
	});

	it("rejects markdown that would break the doc, reporting the diagnostics, without writing", async () => {
		const result = await service.saveNode({
			path: abs,
			id: "title",
			version: versionOf(ORIGINAL),
			markdown: "# Title\n\n<Calout>not a real component</Calout>",
		});
		expect(result.kind).toBe("invalid-doc");
		if (result.kind !== "invalid-doc") return;
		expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
		expect(await fs.readFile(abs, "utf8")).toBe(ORIGINAL);
	});

	it("rejects a save that introduces a mermaid pie fence, without writing", async () => {
		const result = await service.saveNode({
			path: abs,
			id: "title",
			version: versionOf(ORIGINAL),
			markdown: '# Title\n\n```mermaid\npie title Pets\n  "Dogs" : 40\n```',
		});
		expect(result.kind).toBe("invalid-doc");
		if (result.kind !== "invalid-doc") return;
		expect(result.diagnostics.some((diagnostic) => diagnostic.code === "mermaid-chart")).toBe(true);
		expect(await fs.readFile(abs, "utf8")).toBe(ORIGINAL);
	});

	describe("a document that already has errors", () => {
		const TABS_WITHOUT_ID = '<Tabs>\n  <Tab label="One">\n    one\n  </Tab>\n</Tabs>';
		const WITH_ERROR = `# Doc\n\n## Notes\n\nplain notes\n\n## Widgets\n\n${TABS_WITHOUT_ID}\n`;

		it("is the starting point of this group: the tabs have no id", async () => {
			const result = await new ValidationService(
				[{ name: "docs", dir: root }],
				registry,
				service,
			).validateText({ source: WITH_ERROR, absPath: abs });
			expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["missing-id"]);
		});

		it("saves an edit that adds no error", async () => {
			await fs.writeFile(abs, WITH_ERROR);
			const result = await service.saveNode({
				path: abs,
				id: "notes",
				version: versionOf(WITH_ERROR),
				markdown: "## Notes\n\nplain notes, edited\n\nand a second paragraph",
			});
			expect(result.kind).toBe("ok");
			expect(await fs.readFile(abs, "utf8")).toContain("and a second paragraph");
		});

		it("refuses an edit that adds a second error, even one identical to the first", async () => {
			await fs.writeFile(abs, WITH_ERROR);
			const result = await service.saveNode({
				path: abs,
				id: "notes",
				version: versionOf(WITH_ERROR),
				markdown: `## Notes\n\n${TABS_WITHOUT_ID}`,
			});
			expect(result.kind).toBe("invalid-doc");
			expect(await fs.readFile(abs, "utf8")).toBe(WITH_ERROR);
		});

		it("saves an edit that removes the error", async () => {
			await fs.writeFile(abs, WITH_ERROR);
			const result = await service.saveNode({
				path: abs,
				id: "widgets",
				version: versionOf(WITH_ERROR),
				markdown: "## Widgets\n\nno tabs any more",
			});
			expect(result.kind).toBe("ok");
		});

		it("refuses an mdx-syntax error the edit introduces", async () => {
			const result = await service.saveNode({
				path: abs,
				id: "title",
				version: versionOf(ORIGINAL),
				markdown: "# Title\n\nSome {1 +} text",
			});
			expect(result.kind).toBe("invalid-doc");
			if (result.kind !== "invalid-doc") return;
			expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("mdx-syntax");
			expect(await fs.readFile(abs, "utf8")).toBe(ORIGINAL);
		});

		it("allows an edit elsewhere while the same mdx-syntax error stays in another section", async () => {
			const source = "# Doc\n\n## Fine\n\nfine text\n\n## Broken\n\nSome {1 +} text\n";
			await fs.writeFile(abs, source);
			const result = await service.saveNode({
				path: abs,
				id: "fine",
				version: versionOf(source),
				markdown: "## Fine\n\nfine text\n\nwith two more\n\nlines",
			});
			expect(result.kind).toBe("ok");
			expect(await fs.readFile(abs, "utf8")).toContain("Some {1 +} text");
		});

		it("refuses a second mdx-syntax error next to an existing one", async () => {
			const source = "# Doc\n\n## Fine\n\nfine text\n\n## Broken\n\nSome {1 +} text\n";
			await fs.writeFile(abs, source);
			const result = await service.saveNode({
				path: abs,
				id: "fine",
				version: versionOf(source),
				markdown: "## Fine\n\nSome {1 +} text",
			});
			expect(result.kind).toBe("invalid-doc");
			expect(await fs.readFile(abs, "utf8")).toBe(source);
		});
	});

	it("reports a path outside every root as not-found", async () => {
		const secret = path.join(outside, "secret.md");
		await fs.writeFile(secret, "# Secret\n", "utf8");
		const result = await service.saveNode({
			path: secret,
			id: "secret",
			version: versionOf("# Secret\n"),
			markdown: "owned",
		});
		expect(result.kind).toBe("not-found");
		expect(await fs.readFile(secret, "utf8")).toBe("# Secret\n");
	});

	it("leaves no staging file behind, on success or on rejection", async () => {
		await service.saveNode({
			path: abs,
			id: "title",
			version: versionOf(ORIGINAL),
			markdown: "# Title\n\nchanged",
		});
		await service.saveNode({
			path: abs,
			id: "title",
			version: versionOf(ORIGINAL),
			markdown: "stale write",
		});
		const leftovers = (await fs.readdir(root)).filter((name) => name.endsWith(".mdxserve-tmp"));
		expect(leftovers).toEqual([]);
	});

	it("writes through a symlink to its target, leaving the link a link", async () => {
		const link = path.join(root, "alias.md");
		await fs.symlink(abs, link);
		const result = await service.saveNode({
			path: link,
			id: "title",
			version: versionOf(ORIGINAL),
			markdown: "# Title\n\nvia the link",
		});
		expect(result.kind).toBe("ok");
		expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
		expect(await fs.readFile(abs, "utf8")).toBe("# Title\n\nvia the link\n");
	});

	it("preserves the file's mode across the atomic replace", async () => {
		await fs.chmod(abs, 0o640);
		const before = (await fs.stat(abs)).mode;
		await service.saveNode({
			path: abs,
			id: "title",
			version: versionOf(ORIGINAL),
			markdown: "# Title\n\nchanged",
		});
		expect((await fs.stat(abs)).mode).toBe(before);
	});
});

describe("DocsService.updateFrontmatter", () => {
	const setYaml = (yaml: string) => () => ({ kind: "write" as const, yaml });

	it("inserts frontmatter into a doc without any, leaving the body bytes alone", async () => {
		const result = await service.updateFrontmatter({ path: abs, update: setYaml("a: 1\n") });
		expect(result).toMatchObject({ kind: "ok", source: `---\na: 1\n---\n${ORIGINAL}` });
		expect(await fs.readFile(abs, "utf8")).toBe(`---\na: 1\n---\n${ORIGINAL}`);
		if (result.kind === "ok") expect(result.version).toBe(versionOf(`---\na: 1\n---\n${ORIGINAL}`));
	});

	it("inserts after a BOM and uses the file's CRLF line endings", async () => {
		await fs.writeFile(abs, "﻿first\r\nsecond", "utf8");
		await service.updateFrontmatter({ path: abs, update: setYaml("a: 1\nb: 2\n") });
		expect(await fs.readFile(abs, "utf8")).toBe("﻿---\r\na: 1\r\nb: 2\r\n---\r\nfirst\r\nsecond");
	});

	it("replaces existing YAML, including an empty block", async () => {
		await fs.writeFile(abs, "---\nold: 1\nmore: 2\n---\nBody\n", "utf8");
		await service.updateFrontmatter({ path: abs, update: setYaml("new: 1\n") });
		expect(await fs.readFile(abs, "utf8")).toBe("---\nnew: 1\n---\nBody\n");
		await fs.writeFile(abs, "---\n---\nBody", "utf8");
		await service.updateFrontmatter({ path: abs, update: setYaml("x: 1\n") });
		expect(await fs.readFile(abs, "utf8")).toBe("---\nx: 1\n---\nBody");
	});

	it("passes the current YAML (or undefined) to update and honours abort", async () => {
		const seen: (string | undefined)[] = [];
		const aborted = await service.updateFrontmatter({
			path: abs,
			update: (yaml) => {
				seen.push(yaml);
				return { kind: "abort", value: "stop" };
			},
		});
		expect(aborted).toEqual({ kind: "aborted", value: "stop" });
		await fs.writeFile(abs, "---\nk: v\n---\nB\n", "utf8");
		await service.updateFrontmatter({
			path: abs,
			update: (yaml) => {
				seen.push(yaml);
				return { kind: "abort", value: 0 };
			},
		});
		expect(seen).toEqual([undefined, "k: v"]);
		expect(await fs.readFile(abs, "utf8")).toBe("---\nk: v\n---\nB\n");
	});

	it("measures the YAML as written, so CRLF expansion cannot exceed the limit", async () => {
		const yaml = "key: 12345678\n".repeat(4500);
		expect(Buffer.byteLength(yaml)).toBeLessThan(64 * 1024);
		const original = "first\r\nsecond\r\n";
		await fs.writeFile(abs, original, "utf8");
		const result = await service.updateFrontmatter({ path: abs, update: setYaml(yaml) });
		expect(result.kind).toBe("too-large");
		expect(await fs.readFile(abs, "utf8")).toBe(original);
	});

	it("reports not-found and too-large without writing", async () => {
		expect(
			(
				await service.updateFrontmatter({
					path: path.join(root, "nope.md"),
					update: setYaml("a: 1\n"),
				})
			).kind,
		).toBe("not-found");
		expect(
			(
				await service.updateFrontmatter({
					path: abs,
					update: setYaml(`a: ${"x".repeat(65 * 1024)}\n`),
				})
			).kind,
		).toBe("too-large");
		expect(await fs.readFile(abs, "utf8")).toBe(ORIGINAL);
	});

	it("starts again when the file changes during the write, then succeeds", async () => {
		let calls = 0;
		const spy = vi.spyOn(fs, "chmod").mockImplementation(async (...args) => {
			if (++calls === 1) await fs.writeFile(abs, "# Changed\n", "utf8");
			return (await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises")).chmod(
				...args,
			);
		});
		try {
			const result = await service.updateFrontmatter({ path: abs, update: setYaml("a: 1\n") });
			expect(result.kind).toBe("ok");
			expect(await fs.readFile(abs, "utf8")).toBe("---\na: 1\n---\n# Changed\n");
		} finally {
			spy.mockRestore();
		}
	});

	it("returns busy after three attempts that all lose a race", async () => {
		let count = 0;
		const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
		const spy = vi.spyOn(fs, "chmod").mockImplementation(async (...args) => {
			await fs.writeFile(abs, `# Changed ${++count}\n`, "utf8");
			return actual.chmod(...args);
		});
		try {
			expect((await service.updateFrontmatter({ path: abs, update: setYaml("a: 1\n") })).kind).toBe(
				"busy",
			);
			expect(count).toBe(3);
			expect(await fs.readFile(abs, "utf8")).toBe("# Changed 3\n");
		} finally {
			spy.mockRestore();
		}
	});

	it("writes through a symlink and keeps the file mode", async () => {
		const link = path.join(root, "alias.md");
		await fs.symlink(abs, link);
		await fs.chmod(abs, 0o640);
		const before = (await fs.stat(abs)).mode;
		await service.updateFrontmatter({ path: link, update: setYaml("a: 1\n") });
		expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
		expect((await fs.stat(abs)).mode).toBe(before);
		expect(await fs.readFile(abs, "utf8")).toBe(`---\na: 1\n---\n${ORIGINAL}`);
	});

	it("throws rather than write YAML that would swallow body lines", async () => {
		await expect(
			service.updateFrontmatter({ path: abs, update: setYaml("a: 1\n---\nsneaky: true\n") }),
		).rejects.toThrow();
		expect(await fs.readFile(abs, "utf8")).toBe(ORIGINAL);
	});

	it("serializes with saveNode through the shared lock", async () => {
		const [saved, updated] = await Promise.all([
			service.saveNode({
				path: abs,
				id: "title",
				version: versionOf(ORIGINAL),
				markdown: "# Title\n\nedited",
			}),
			service.updateFrontmatter({ path: abs, update: setYaml("a: 1\n") }),
		]);
		// Which call takes the lock first is not fixed. Either way the frontmatter
		// write lands, and the section save either lands too or is refused as
		// stale: never a lost update and never a half-written file.
		expect(updated.kind).toBe("ok");
		const text = await fs.readFile(abs, "utf8");
		if (saved.kind === "ok") {
			expect(text).toBe("---\na: 1\n---\n# Title\n\nedited\n");
		} else {
			expect(saved.kind).toBe("stale");
			expect(text).toBe(`---\na: 1\n---\n${ORIGINAL}`);
		}
	});
});
