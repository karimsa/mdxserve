import { describe, expect, it } from "vitest";
import { editComments, parseComments } from "../../src/comments/frontmatter.js";
import type { CommentThread } from "../../src/comments/schema.js";

const THREAD_YAML = `comments:
  - id: k3J9xQ2a
    anchor:
      heading: Installation
      block: Run the installer.
      quote: installer
    resolved: false
    messages:
      - id: Zp41mD0c
        author: human
        body: Is a restart needed?
        createdAt: 2026-11-24T19:02:11.000Z
      - id: m2
        author: agent
        body: No.
`;

function doc(yamlText: string, body = "# Body\n"): string {
	return `---\n${yamlText}---\n${body}`;
}

const NEW_THREAD: CommentThread = {
	id: "t1",
	anchor: { heading: null, block: "Hello world", quote: "world" },
	resolved: false,
	messages: [{ id: "m1", author: "human", body: "Why?" }],
};

describe("parseComments", () => {
	it("returns no threads without frontmatter", () => {
		expect(parseComments("# Title\n")).toMatchObject({ threads: [], diagnostics: [] });
	});

	it("reads a valid thread and defaults resolved to false", () => {
		const parsed = parseComments(doc(THREAD_YAML.replace("    resolved: false\n", "")));
		expect(parsed.diagnostics).toEqual([]);
		expect(parsed.threads).toHaveLength(1);
		expect(parsed.threads[0]).toMatchObject({
			id: "k3J9xQ2a",
			resolved: false,
			anchor: { heading: "Installation" },
		});
		expect(parsed.threads[0].messages.map((message) => message.author)).toEqual(["human", "agent"]);
		expect(parsed.positions.get("k3J9xQ2a")).toEqual({ line: 3, column: 5 });
	});

	it("handles an empty frontmatter block, an absent key, and a null key", () => {
		expect(parseComments("---\n---\nBody").threads).toEqual([]);
		expect(parseComments(doc("title: A\n")).threads).toEqual([]);
		expect(parseComments(doc("comments:\n")).diagnostics).toEqual([]);
	});

	it("reports a non-list comments value", () => {
		const parsed = parseComments(doc("comments: nope\n"));
		expect(parsed.threads).toEqual([]);
		expect(parsed.diagnostics).toHaveLength(1);
		expect(parsed.diagnostics[0]).toMatchObject({
			severity: "warning",
			code: "frontmatter-comments",
			line: 2,
		});
	});

	it("skips invalid entries with a line number and keeps valid siblings", () => {
		const parsed = parseComments(
			doc(`comments:\n  - id: bad id\n${THREAD_YAML.split("\n").slice(1).join("\n")}`),
		);
		expect(parsed.threads.map((thread) => thread.id)).toEqual(["k3J9xQ2a"]);
		expect(parsed.diagnostics).toHaveLength(1);
		expect(parsed.diagnostics[0].line).toBe(3);
	});

	it("rejects entries that use aliases or custom tags", () => {
		const aliased = `comments:
  - id: a1
    anchor: &anchor
      heading: H
      block: B
      quote: Q
    messages:
      - id: m1
        author: human
        body: x
  - id: a2
    anchor: *anchor
    messages:
      - id: m1
        author: human
        body: x
  - id: a3
    anchor: { heading: H, block: B, quote: Q }
    messages:
      - id: m1
        author: human
        body: !custom x
`;
		const parsed = parseComments(doc(aliased));
		expect(parsed.threads.map((thread) => thread.id)).toEqual(["a1"]);
		expect(parsed.diagnostics).toHaveLength(2);
	});

	it("keeps the first of duplicate thread ids and duplicate message ids", () => {
		const duplicate = THREAD_YAML.replace("id: m2", "id: Zp41mD0c");
		const parsed = parseComments(doc(duplicate + THREAD_YAML.split("\n").slice(1).join("\n")));
		expect(parsed.threads).toHaveLength(1);
		expect(parsed.threads[0].messages).toHaveLength(1);
		expect(parsed.diagnostics).toHaveLength(2);
	});

	it("says nothing about a YAML syntax error", () => {
		expect(parseComments("---\ncomments: [\n---\n")).toMatchObject({
			threads: [],
			diagnostics: [],
		});
	});

	it("reads CRLF documents with a BOM", () => {
		const source = `﻿---\r\n${THREAD_YAML.replace(/\n/g, "\r\n")}---\r\nBody\r\n`;
		expect(parseComments(source).threads).toHaveLength(1);
	});
});

describe("editComments", () => {
	it("creates comments in an absent, empty, or null-valued frontmatter", () => {
		for (const start of [undefined, "", "# only a comment\n", "comments:\n"]) {
			const edited = editComments(start, { kind: "add-thread", thread: NEW_THREAD });
			expect(edited.kind).toBe("ok");
			if (edited.kind !== "ok") continue;
			expect(parseComments(`---\n${edited.yaml}---\n`).threads).toEqual([NEW_THREAD]);
		}
	});

	it("keeps unknown keys, YAML comments, and invalid sibling entries", () => {
		const start = `title: Hi # keep me\nextra:\n  nested: [1, 2]\ncomments:\n  - not a thread\n  - id: x\n    unknown: 7\n`;
		const edited = editComments(start, { kind: "add-thread", thread: NEW_THREAD });
		expect(edited.kind).toBe("ok");
		if (edited.kind !== "ok") return;
		expect(edited.yaml).toContain("# keep me");
		expect(edited.yaml).toContain("- not a thread");
		expect(edited.yaml).toContain("unknown: 7");
		expect(edited.yaml).toContain("nested:");
		expect(parseComments(`---\n${edited.yaml}---\n`).threads.map((thread) => thread.id)).toEqual([
			"t1",
		]);
	});

	it("keeps unknown keys on a thread when replying and resolving", () => {
		const start = THREAD_YAML.replace(
			"    resolved: false",
			"    resolved: false\n    labels: [a]",
		);
		const replied = editComments(start, {
			kind: "add-message",
			threadId: "k3J9xQ2a",
			message: { id: "m3", author: "human", body: "ok" },
		});
		if (replied.kind !== "ok") throw new Error(replied.kind);
		const resolved = editComments(replied.yaml, {
			kind: "set-resolved",
			threadId: "k3J9xQ2a",
			resolved: true,
		});
		if (resolved.kind !== "ok") throw new Error(resolved.kind);
		expect(resolved.yaml).toContain("labels:");
		const [thread] = parseComments(`---\n${resolved.yaml}---\n`).threads;
		expect(thread.resolved).toBe(true);
		expect(thread.messages.map((message) => message.id)).toEqual(["Zp41mD0c", "m2", "m3"]);
	});

	it("edits a human message and refuses an agent message", () => {
		const edited = editComments(THREAD_YAML, {
			kind: "edit-message",
			threadId: "k3J9xQ2a",
			messageId: "Zp41mD0c",
			body: "Multi\nline: body",
			editedAt: "2026-11-25T00:00:00.000Z",
		});
		if (edited.kind !== "ok") throw new Error(edited.kind);
		const [thread] = parseComments(`---\n${edited.yaml}---\n`).threads;
		expect(thread.messages[0]).toMatchObject({
			body: "Multi\nline: body",
			editedAt: "2026-11-25T00:00:00.000Z",
		});
		expect(
			editComments(THREAD_YAML, {
				kind: "edit-message",
				threadId: "k3J9xQ2a",
				messageId: "m2",
				body: "x",
				editedAt: "2026-11-25T00:00:00.000Z",
			}),
		).toEqual({ kind: "not-editable" });
	});

	it("reports missing threads and messages", () => {
		expect(
			editComments(THREAD_YAML, { kind: "set-resolved", threadId: "nope", resolved: true }),
		).toEqual({ kind: "thread-not-found" });
		expect(
			editComments(undefined, { kind: "set-resolved", threadId: "a", resolved: true }),
		).toEqual({ kind: "thread-not-found" });
		expect(
			editComments(THREAD_YAML, {
				kind: "edit-message",
				threadId: "k3J9xQ2a",
				messageId: "nope",
				body: "x",
				editedAt: "2026-11-25T00:00:00.000Z",
			}),
		).toEqual({ kind: "message-not-found" });
	});

	it("refuses invalid YAML, a non-map root, and a non-list comments key", () => {
		for (const start of ["a: [", "- 1\n- 2\n", "comments: 3\n", "a: 1\na: 2\n"]) {
			expect(editComments(start, { kind: "add-thread", thread: NEW_THREAD }).kind).toBe(
				"invalid-frontmatter",
			);
		}
	});
});

describe("parseComments diagnostics for hand-written entries", () => {
	it("names every problem of a malformed thread in one warning", () => {
		const source = [
			"---",
			"comments:",
			"  - id: bad id",
			"    anchor: { heading: Usage, block: text, quote: text }",
			"    messages:",
			'      - { id: m1, author: robot, body: "" }',
			"---",
			"# Doc",
			"",
		].join("\n");
		const { threads, diagnostics } = parseComments(source);
		expect(threads).toEqual([]);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].code).toBe("frontmatter-comments");
		expect(diagnostics[0].line).toBe(3);
		expect(diagnostics[0].message).toContain("id:");
		expect(diagnostics[0].message).toContain("messages.0.author:");
		expect(diagnostics[0].message).toContain("messages.0.body:");
	});
});
