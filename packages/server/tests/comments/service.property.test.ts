import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { CommentsService } from "../../src/comments/service.js";
import { parseComments } from "../../src/comments/frontmatter.js";
import { MAX_YAML_BYTES, parseMetadata } from "../../src/docs/metadata.js";
import { bodyLines, leadingFrontmatter } from "../../src/docs/frontmatter.js";
import { DocsService } from "../../src/docs/service.js";
import { RootsService } from "../../src/roots/service.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

let root: string;
let counter = 0;

beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-comments-prop-")));
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

const startArb = fc.constantFrom(
	"# Title\n\nBody text.\n",
	"---\ntitle: Hello\ndescription: d\n---\n# Title\n\nBody.\n",
	"---\n---\nNo heading\n",
	"﻿---\r\ntitle: Crlf\r\n---\r\nLine\r\n\r\ntext",
	"---\ntitle: Dashes\n---\n---\nnot frontmatter\n---\n",
	"",
);

const textArb = fc.oneof(
	fc.string({ minLength: 1, maxLength: 120 }),
	fc.constantFrom("---", "a\n---\nb", "x: y", "é🙂\n", "  padded  "),
);

const stepArb = fc.oneof(
	fc.record({ kind: fc.constant("thread" as const), body: textArb, quote: textArb }),
	fc.record({ kind: fc.constant("reply" as const), pick: fc.nat(), body: textArb }),
	fc.record({ kind: fc.constant("edit" as const), pick: fc.nat(), body: textArb }),
	fc.record({ kind: fc.constant("resolve" as const), pick: fc.nat(), resolved: fc.boolean() }),
	fc.record({ kind: fc.constant("bad-thread" as const), id: fc.constant("nope") }),
);

describe("CommentsService properties", () => {
	it("keeps the body, page metadata, and size limit through any mutation sequence", async () => {
		await fc.assert(
			fc.asyncProperty(startArb, fc.array(stepArb, { maxLength: 8 }), async (start, steps) => {
				const abs = path.join(root, `doc-${counter++}.md`);
				await fs.writeFile(abs, start, "utf8");
				const service = new CommentsService(
					new DocsService(new RootsService(root, os.homedir(), [root]), registry),
				);
				const bodyBefore = bodyLines(start);
				const metadataBefore = parseMetadata(start).metadata;
				for (const step of steps) {
					const before = await fs.readFile(abs, "utf8");
					const threads = parseComments(before).threads;
					const thread = threads.length
						? threads[("pick" in step ? step.pick : 0) % threads.length]
						: undefined;
					const anchor = { heading: null, block: "b", quote: "q" };
					let result;
					if (step.kind === "thread") {
						result = await service.addThread({
							path: abs,
							anchor: { ...anchor, quote: step.quote.trim() || "q" },
							body: step.body.trim() || "b",
						});
					} else if (step.kind === "reply") {
						result = await service.addReply({
							path: abs,
							threadId: thread?.id ?? "none",
							body: step.body.trim() || "b",
						});
					} else if (step.kind === "edit") {
						result = await service.editMessage({
							path: abs,
							threadId: thread?.id ?? "none",
							messageId: thread?.messages[0].id ?? "none",
							body: step.body.trim() || "b",
						});
					} else if (step.kind === "resolve") {
						result = await service.setResolved({
							path: abs,
							threadId: thread?.id ?? "none",
							resolved: step.resolved,
						});
					} else {
						result = await service.addReply({ path: abs, threadId: step.id, body: "b" });
					}
					const after = await fs.readFile(abs, "utf8");
					if (result.kind !== "ok") expect(after).toBe(before);
					expect(bodyLines(after)).toEqual(bodyBefore);
					expect(parseMetadata(after).metadata).toEqual(metadataBefore);
					expect(
						Buffer.byteLength(leadingFrontmatter(after)?.value ?? "", "utf8"),
					).toBeLessThanOrEqual(MAX_YAML_BYTES);
					if (result.kind === "ok") expect(result.threads).toEqual(parseComments(after).threads);
				}
			}),
			{ numRuns: 40 },
		);
	}, 60_000);
});
