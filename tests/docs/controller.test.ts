import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import type { ApiContext } from "../../src/api/trpc.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext as buildContext } from "../helpers/context.js";
import { versionOf } from "../../src/docs/service.js";

let fixtureDir: string;
let outsideDir: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-docs-controller-test-")),
	);
	outsideDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-docs-controller-outside-")),
	);

	await fs.writeFile(
		path.join(fixtureDir, "good.md"),
		"# Good doc\n\nSome plain GFM content about widgets and gadgets.\n",
		"utf8",
	);
	await fs.writeFile(path.join(outsideDir, "secret.md"), "# Secret\n", "utf8");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
	await fs.rm(outsideDir, { recursive: true, force: true });
});

function makeContext(overrides: Partial<ApiContext> = {}): ApiContext {
	return buildContext(fixtureDir, registry, overrides);
}

const createCaller = createCallerFactory(appRouter);

describe("getDocSource", () => {
	it("returns the raw text and a version token for those exact bytes", async () => {
		const abs = path.join(fixtureDir, "good.md");
		const source = await createCaller(makeContext()).getDocSource({ path: abs });
		expect(source.text).toBe(await fs.readFile(abs, "utf8"));
		expect(source.version).toBe(versionOf(source.text));
	});

	it("rejects a path outside every root with NOT_FOUND", async () => {
		await expect(
			createCaller(makeContext()).getDocSource({ path: path.join(outsideDir, "secret.md") }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects a file over the editor size cap with PAYLOAD_TOO_LARGE", async () => {
		const abs = path.join(fixtureDir, "huge.md");
		await fs.writeFile(abs, "# Huge\n\n" + "x".repeat(2 * 1024 * 1024 + 1), "utf8");
		try {
			await expect(createCaller(makeContext()).getDocSource({ path: abs })).rejects.toMatchObject({
				code: "PAYLOAD_TOO_LARGE",
			});
		} finally {
			await fs.rm(abs, { force: true });
		}
	});
});

describe("saveDocSection", () => {
	const original = "# Title\n\nline three\n\nline five\n";
	let counter = 0;

	async function freshDoc(): Promise<string> {
		const abs = path.join(fixtureDir, `edit-${counter++}.md`);
		await fs.writeFile(abs, original, "utf8");
		return abs;
	}

	it("replaces exactly the requested line range and returns the new version", async () => {
		const abs = await freshDoc();
		const caller = createCaller(makeContext());
		const before = await caller.getDocSource({ path: abs });
		const result = await caller.saveDocSection({
			path: abs,
			startLine: 3,
			endLine: 3,
			version: before.version,
			markdown: "changed line\n",
		});
		const written = "# Title\n\nchanged line\n\nline five\n";
		expect(await fs.readFile(abs, "utf8")).toBe(written);
		expect(result.version).toBe(versionOf(written));
	});

	it("rejects a stale version with CONFLICT and leaves the file untouched", async () => {
		const abs = await freshDoc();
		await expect(
			createCaller(makeContext()).saveDocSection({
				path: abs,
				startLine: 3,
				endLine: 3,
				version: versionOf("something else entirely"),
				markdown: "changed",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await fs.readFile(abs, "utf8")).toBe(original);
	});

	it("rejects a line range past the end of the file with CONFLICT", async () => {
		const abs = await freshDoc();
		await expect(
			createCaller(makeContext()).saveDocSection({
				path: abs,
				startLine: 3,
				endLine: 99,
				version: versionOf(original),
				markdown: "changed",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await fs.readFile(abs, "utf8")).toBe(original);
	});

	it("rejects markdown that would break the doc with UNPROCESSABLE_CONTENT, without writing", async () => {
		const abs = await freshDoc();
		await expect(
			createCaller(makeContext()).saveDocSection({
				path: abs,
				startLine: 3,
				endLine: 3,
				version: versionOf(original),
				markdown: "<Calout>not a real component</Calout>",
			}),
		).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
		expect(await fs.readFile(abs, "utf8")).toBe(original);
	});

	it("rejects a path outside every root with NOT_FOUND", async () => {
		await expect(
			createCaller(makeContext()).saveDocSection({
				path: path.join(outsideDir, "secret.md"),
				startLine: 1,
				endLine: 1,
				version: versionOf("some other content"),
				markdown: "x",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("getDocument", () => {
	it("returns the parsed tree and the same version token getDocSource returns", async () => {
		const abs = path.join(fixtureDir, "good.md");
		const caller = createCaller(makeContext());
		const result = await caller.getDocument({ path: abs });
		const source = await caller.getDocSource({ path: abs });
		expect(result.version).toBe(source.version);
		expect(result.document.schemaVersion).toBe(1);
		expect(result.document.children).toMatchObject([
			{ type: "section", id: "good-doc", level: 1, heading: [{ type: "text", value: "Good doc" }] },
		]);
	});

	it("needs no same-machine connection", async () => {
		const abs = path.join(fixtureDir, "good.md");
		const result = await createCaller(makeContext({ isLoopback: false })).getDocument({
			path: abs,
		});
		expect(result.document.children).toHaveLength(1);
	});

	it("serves neither an import nor a script from the document", async () => {
		const abs = path.join(fixtureDir, "code.mdx");
		await fs.writeFile(
			abs,
			'import Thing from "./thing.js"\n\n# Code\n\nText <script>alert("x")</script> {window.location}\n',
			"utf8",
		);
		const result = await createCaller(makeContext()).getDocument({ path: abs });
		const text = JSON.stringify(result);
		expect(text).not.toContain("import");
		expect(text).not.toContain("alert");
		expect(text).not.toContain("window");
		expect(text).toContain("Text");
	});

	it("rewrites a relative image to the URL the server serves the file at", async () => {
		const abs = path.join(fixtureDir, "image.md");
		await fs.writeFile(abs, "![shot](<./img/my shot.png>)\n", "utf8");
		const result = await createCaller(makeContext()).getDocument({ path: abs });
		expect(JSON.stringify(result.document)).toContain(
			`"src":"${encodeURI(path.join(fixtureDir, "img", "my shot.png"))}"`,
		);
	});

	it("rejects a path outside every root with NOT_FOUND", async () => {
		await expect(
			createCaller(makeContext()).getDocument({ path: path.join(outsideDir, "secret.md") }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("applies the restricted-mode path rules", async () => {
		await fs.mkdir(path.join(fixtureDir, ".private"), { recursive: true });
		await fs.writeFile(path.join(fixtureDir, ".private", "hidden.md"), "# Hidden\n", "utf8");
		// A visible link to a hidden file: served locally, refused to a public reader.
		const link = path.join(fixtureDir, "linked.md");
		await fs.symlink(path.join(".private", "hidden.md"), link);
		const local = await createCaller(makeContext()).getDocument({ path: link });
		expect(local.document.children).toMatchObject([{ type: "section", id: "hidden" }]);
		await expect(
			createCaller(makeContext({ permissions: "restricted" })).getDocument({ path: link }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects a file over the size cap with PAYLOAD_TOO_LARGE", async () => {
		const abs = path.join(fixtureDir, "huge-tree.md");
		await fs.writeFile(abs, "# Huge\n\n" + "x".repeat(2 * 1024 * 1024 + 1), "utf8");
		try {
			await expect(createCaller(makeContext()).getDocument({ path: abs })).rejects.toMatchObject({
				code: "PAYLOAD_TOO_LARGE",
			});
		} finally {
			await fs.rm(abs, { force: true });
		}
	});
});
