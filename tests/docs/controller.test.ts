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

describe("getNodeSource", () => {
	it("returns the lines of a node with the version of the bytes they came from", async () => {
		const abs = path.join(fixtureDir, "good.md");
		const caller = createCaller(makeContext());
		const result = await caller.getNodeSource({ path: abs, id: "good-doc" });
		const source = await caller.getDocSource({ path: abs });
		expect(result).toEqual({
			markdown: "# Good doc\n\nSome plain GFM content about widgets and gadgets.",
			version: source.version,
		});
	});

	it("rejects an unknown id and a path outside every root with NOT_FOUND", async () => {
		const caller = createCaller(makeContext());
		await expect(
			caller.getNodeSource({ path: path.join(fixtureDir, "good.md"), id: "nope" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			caller.getNodeSource({ path: path.join(outsideDir, "secret.md"), id: "secret" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects a file over the size cap with PAYLOAD_TOO_LARGE", async () => {
		const abs = path.join(fixtureDir, "huge-node.md");
		await fs.writeFile(abs, "# Huge\n\n" + "x".repeat(2 * 1024 * 1024 + 1), "utf8");
		try {
			await expect(
				createCaller(makeContext()).getNodeSource({ path: abs, id: "huge" }),
			).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
		} finally {
			await fs.rm(abs, { force: true });
		}
	});

	it("applies the public path rules in restricted mode", async () => {
		const hidden = path.join(fixtureDir, ".hidden-node.md");
		await fs.writeFile(hidden, "# Hidden\n", "utf8");
		try {
			const restricted = createCaller(makeContext({ permissions: "restricted" }));
			await expect(restricted.getNodeSource({ path: hidden, id: "hidden" })).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
			const good = path.join(fixtureDir, "good.md");
			expect((await restricted.getNodeSource({ path: good, id: "good-doc" })).markdown).toContain(
				"# Good doc",
			);
		} finally {
			await fs.rm(hidden, { force: true });
		}
	});
});

describe("saveDocNode", () => {
	const original = "# Title\n\nline three\n\nline five\n";
	let counter = 0;

	async function freshDoc(content = original): Promise<string> {
		const abs = path.join(fixtureDir, `edit-${counter++}.md`);
		await fs.writeFile(abs, content, "utf8");
		return abs;
	}

	it("replaces exactly the node's lines and returns the new version", async () => {
		const abs = await freshDoc();
		const caller = createCaller(makeContext());
		const before = await caller.getNodeSource({ path: abs, id: "title" });
		const result = await caller.saveDocNode({
			path: abs,
			id: "title",
			version: before.version,
			markdown: "# Title\n\nchanged line\n\nline five\n",
		});
		const written = "# Title\n\nchanged line\n\nline five\n";
		expect(await fs.readFile(abs, "utf8")).toBe(written);
		expect(result.version).toBe(versionOf(written));
	});

	it("saves a mermaid block and a builtin block by their ids", async () => {
		const abs = await freshDoc(
			'# Title\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n<Callout tone="tip">Hi</Callout>\n',
		);
		const caller = createCaller(makeContext());
		const first = await caller.getNodeSource({ path: abs, id: "title>~mermaid-1" });
		const afterDiagram = await caller.saveDocNode({
			path: abs,
			id: "title>~mermaid-1",
			version: first.version,
			markdown: "```mermaid\nflowchart TD\n  A --> C\n```",
		});
		const afterBlock = await caller.saveDocNode({
			path: abs,
			id: "title>~callout-1",
			version: afterDiagram.version,
			markdown: '<Callout tone="warn">Careful</Callout>',
		});
		const written =
			'# Title\n\n```mermaid\nflowchart TD\n  A --> C\n```\n\n<Callout tone="warn">Careful</Callout>\n';
		expect(await fs.readFile(abs, "utf8")).toBe(written);
		expect(afterBlock.version).toBe(versionOf(written));
	});

	it("rejects a stale version with CONFLICT, before it looks the id up, and leaves the file untouched", async () => {
		const abs = await freshDoc();
		await expect(
			createCaller(makeContext()).saveDocNode({
				path: abs,
				id: "no-such-node",
				version: versionOf("something else entirely"),
				markdown: "changed",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(await fs.readFile(abs, "utf8")).toBe(original);
	});

	it("rejects an unknown id with NOT_FOUND", async () => {
		const abs = await freshDoc();
		await expect(
			createCaller(makeContext()).saveDocNode({
				path: abs,
				id: "no-such-node",
				version: versionOf(original),
				markdown: "changed",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(await fs.readFile(abs, "utf8")).toBe(original);
	});

	it("rejects an edit that introduces an error with UNPROCESSABLE_CONTENT, without writing", async () => {
		const abs = await freshDoc();
		await expect(
			createCaller(makeContext()).saveDocNode({
				path: abs,
				id: "title",
				version: versionOf(original),
				markdown: "# Title\n\n<Calout>not a real component</Calout>",
			}),
		).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
		expect(await fs.readFile(abs, "utf8")).toBe(original);
	});

	it("saves an edit to a doc that already has an error when the edit adds none", async () => {
		const source =
			'# Doc\n\n## Notes\n\nplain\n\n## Widgets\n\n<Tabs>\n  <Tab label="One">\n    one\n  </Tab>\n</Tabs>\n';
		const abs = await freshDoc(source);
		const result = await createCaller(makeContext()).saveDocNode({
			path: abs,
			id: "notes",
			version: versionOf(source),
			markdown: "## Notes\n\nplain, edited",
		});
		expect(result.version).toBe(versionOf(await fs.readFile(abs, "utf8")));
		expect(await fs.readFile(abs, "utf8")).toContain("plain, edited");
	});

	it("rejects a path outside every root with NOT_FOUND", async () => {
		await expect(
			createCaller(makeContext()).saveDocNode({
				path: path.join(outsideDir, "secret.md"),
				id: "secret",
				version: versionOf("some other content"),
				markdown: "x",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("is refused in restricted mode", async () => {
		const abs = await freshDoc();
		await expect(
			createCaller(makeContext({ permissions: "restricted" })).saveDocNode({
				path: abs,
				id: "title",
				version: versionOf(original),
				markdown: "# Title\n\ndefaced",
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(await fs.readFile(abs, "utf8")).toBe(original);
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
