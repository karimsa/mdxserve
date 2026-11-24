import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommentsService } from "../../src/comments/service.js";
import { parseComments } from "../../src/comments/frontmatter.js";
import { DocsService } from "../../src/docs/service.js";
import { RootsService } from "../../src/roots/service.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

let root: string;
let abs: string;
let comments: CommentsService;

const BODY = "# Title\n\nSome paragraph text here.\n";
const ANCHOR = { heading: "Title", block: "Some paragraph text here.", quote: "paragraph" };

beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-comments-svc-")));
	abs = path.join(root, "doc.md");
	await fs.writeFile(abs, BODY, "utf8");
	comments = new CommentsService(
		new DocsService(new RootsService(root, os.homedir(), [root]), registry),
	);
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

async function addThread() {
	const added = await comments.addThread({ path: abs, anchor: ANCHOR, body: "First" });
	if (added.kind !== "ok") throw new Error(added.kind);
	return added.threads[0];
}

describe("CommentsService", () => {
	it("lists nothing for a doc without comments and reports a missing doc", async () => {
		expect(await comments.list(abs, false)).toEqual({ kind: "ok", threads: [], diagnostics: [] });
		expect((await comments.list(path.join(root, "nope.md"), false)).kind).toBe("not-found");
	});

	it("adds a thread with a human message, a generated id, and createdAt", async () => {
		const thread = await addThread();
		expect(thread.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
		expect(thread.resolved).toBe(false);
		expect(thread.messages).toHaveLength(1);
		expect(thread.messages[0]).toMatchObject({ author: "human", body: "First" });
		expect(thread.messages[0].createdAt).toMatch(/Z$/);
		const text = await fs.readFile(abs, "utf8");
		expect(text.endsWith(BODY)).toBe(true);
		expect(parseComments(text).threads).toEqual([thread]);
	});

	it("normalizes and clips anchor text", async () => {
		const added = await comments.addThread({
			path: abs,
			anchor: { heading: "  A \n B ", block: `  ${"x".repeat(499)}  y  z`, quote: " q \t r " },
			body: "x",
		});
		if (added.kind !== "ok") throw new Error(added.kind);
		expect(added.threads[0].anchor.heading).toBe("A B");
		expect(added.threads[0].anchor.quote).toBe("q r");
		expect(added.threads[0].anchor.block).toHaveLength(500);
		expect(added.threads[0].anchor.block.endsWith("y z")).toBe(true);
	});

	it("replies, edits, resolves, and reopens", async () => {
		const thread = await addThread();
		const replied = await comments.addReply({ path: abs, threadId: thread.id, body: "Reply" });
		if (replied.kind !== "ok") throw new Error(replied.kind);
		expect(replied.threads[0].messages.map((message) => message.body)).toEqual(["First", "Reply"]);
		const edited = await comments.editMessage({
			path: abs,
			threadId: thread.id,
			messageId: replied.threads[0].messages[1].id,
			body: "Changed",
		});
		if (edited.kind !== "ok") throw new Error(edited.kind);
		expect(edited.threads[0].messages[1]).toMatchObject({ body: "Changed" });
		expect(edited.threads[0].messages[1].editedAt).toBeDefined();
		const resolved = await comments.setResolved({ path: abs, threadId: thread.id, resolved: true });
		expect(resolved).toMatchObject({ kind: "ok", threads: [{ resolved: true }] });
		const reopened = await comments.setResolved({
			path: abs,
			threadId: thread.id,
			resolved: false,
		});
		expect(reopened).toMatchObject({ kind: "ok", threads: [{ resolved: false }] });
	});

	it("returns not-found, thread-not-found, message-not-found, and not-editable", async () => {
		const missing = path.join(root, "nope.md");
		expect((await comments.addThread({ path: missing, anchor: ANCHOR, body: "x" })).kind).toBe(
			"not-found",
		);
		expect(
			(await comments.setResolved({ path: missing, threadId: "a", resolved: true })).kind,
		).toBe("not-found");
		const thread = await addThread();
		expect((await comments.addReply({ path: abs, threadId: "zzz", body: "x" })).kind).toBe(
			"thread-not-found",
		);
		expect((await comments.setResolved({ path: abs, threadId: "zzz", resolved: true })).kind).toBe(
			"thread-not-found",
		);
		expect(
			(await comments.editMessage({ path: abs, threadId: thread.id, messageId: "zzz", body: "x" }))
				.kind,
		).toBe("message-not-found");
		const text = await fs.readFile(abs, "utf8");
		await fs.writeFile(abs, text.replace("author: human", "author: agent"), "utf8");
		expect(
			(
				await comments.editMessage({
					path: abs,
					threadId: thread.id,
					messageId: thread.messages[0].id,
					body: "x",
				})
			).kind,
		).toBe("not-editable");
	});

	it("refuses to write over invalid YAML and leaves the file alone", async () => {
		const broken = "---\ntitle: [\n---\n# Body\n";
		await fs.writeFile(abs, broken, "utf8");
		const result = await comments.addThread({ path: abs, anchor: ANCHOR, body: "x" });
		expect(result.kind).toBe("invalid-frontmatter");
		expect(await fs.readFile(abs, "utf8")).toBe(broken);
	});

	it("refuses a write that would push the frontmatter past 64 KiB", async () => {
		const big = `---\ntitle: T\nnote: ${"x".repeat(64 * 1024 - 60)}\n---\n# Body\n`;
		await fs.writeFile(abs, big, "utf8");
		expect(
			(await comments.addThread({ path: abs, anchor: ANCHOR, body: "x".repeat(3000) })).kind,
		).toBe("too-large");
		expect(await fs.readFile(abs, "utf8")).toBe(big);
	});

	it("lists threads and diagnostics from a hand-edited doc", async () => {
		await fs.writeFile(abs, "---\ncomments:\n  - id: bad id\n---\n# Body\n", "utf8");
		const listed = await comments.list(abs, false);
		expect(listed).toMatchObject({ kind: "ok", threads: [] });
		if (listed.kind === "ok") expect(listed.diagnostics).toHaveLength(1);
	});

	it("keeps each of two overlapping writes", async () => {
		const results = await Promise.all(
			["a", "b", "c", "d"].map((body) => comments.addThread({ path: abs, anchor: ANCHOR, body })),
		);
		expect(results.every((result) => result.kind === "ok")).toBe(true);
		expect(parseComments(await fs.readFile(abs, "utf8")).threads).toHaveLength(4);
	});
});
