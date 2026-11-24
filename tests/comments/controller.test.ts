import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import type { ApiContext } from "../../src/api/trpc.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext as buildContext } from "../helpers/context.js";

const createCaller = createCallerFactory(appRouter);
const ANCHOR = { heading: null, block: "Hello", quote: "Hello" };

let root: string;
let abs: string;

beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-comments-ctl-")));
	abs = path.join(root, "doc.md");
	await fs.writeFile(abs, "Hello world\n", "utf8");
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

function caller(overrides: Partial<ApiContext> = {}) {
	return createCaller(buildContext(root, registry, overrides));
}

async function code(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof TRPCError) return error.code;
		throw error;
	}
	return "OK";
}

describe("comments controller", () => {
	it("round-trips a thread through every procedure", async () => {
		const api = caller();
		const { threads } = await api.addCommentThread({ path: abs, anchor: ANCHOR, body: "Q" });
		const [thread] = threads;
		const replied = await api.addCommentReply({ path: abs, threadId: thread.id, body: "R" });
		expect(replied.threads[0].messages).toHaveLength(2);
		const edited = await api.editComment({
			path: abs,
			threadId: thread.id,
			messageId: thread.messages[0].id,
			body: "Q2",
		});
		expect(edited.threads[0].messages[0].body).toBe("Q2");
		const resolved = await api.setCommentThreadResolved({
			path: abs,
			threadId: thread.id,
			resolved: true,
		});
		expect(resolved.threads[0].resolved).toBe(true);
		expect(await api.getDocComments({ path: abs })).toMatchObject({
			threads: resolved.threads,
			diagnostics: [],
		});
	});

	it("maps result kinds to TRPC codes", async () => {
		const api = caller();
		const missing = path.join(root, "nope.md");
		expect(await code(api.getDocComments({ path: missing }))).toBe("NOT_FOUND");
		expect(await code(api.addCommentThread({ path: missing, anchor: ANCHOR, body: "x" }))).toBe(
			"NOT_FOUND",
		);
		expect(await code(api.addCommentReply({ path: abs, threadId: "zz", body: "x" }))).toBe(
			"NOT_FOUND",
		);
		expect(
			await code(api.editComment({ path: abs, threadId: "zz", messageId: "m", body: "x" })),
		).toBe("NOT_FOUND");
		const { threads } = await api.addCommentThread({ path: abs, anchor: ANCHOR, body: "Q" });
		expect(
			await code(
				api.editComment({ path: abs, threadId: threads[0].id, messageId: "zz", body: "x" }),
			),
		).toBe("NOT_FOUND");
		await fs.writeFile(
			abs,
			(await fs.readFile(abs, "utf8")).replace("author: human", "author: agent"),
			"utf8",
		);
		expect(
			await code(
				api.editComment({
					path: abs,
					threadId: threads[0].id,
					messageId: threads[0].messages[0].id,
					body: "x",
				}),
			),
		).toBe("FORBIDDEN");
		await fs.writeFile(abs, "---\na: [\n---\nx\n", "utf8");
		expect(await code(api.addCommentThread({ path: abs, anchor: ANCHOR, body: "x" }))).toBe(
			"UNPROCESSABLE_CONTENT",
		);
		await fs.writeFile(abs, `---\nnote: ${"x".repeat(64 * 1024 - 20)}\n---\nx\n`, "utf8");
		expect(await code(api.addCommentThread({ path: abs, anchor: ANCHOR, body: "x" }))).toBe(
			"PAYLOAD_TOO_LARGE",
		);
	});

	it("rejects mutations on a restricted server and from another origin, but reads on restricted", async () => {
		const { threads } = await caller().addCommentThread({ path: abs, anchor: ANCHOR, body: "Q" });
		const restricted = caller({ permissions: "restricted" });
		expect(await code(restricted.addCommentThread({ path: abs, anchor: ANCHOR, body: "x" }))).toBe(
			"FORBIDDEN",
		);
		expect(
			await code(restricted.addCommentReply({ path: abs, threadId: threads[0].id, body: "x" })),
		).toBe("FORBIDDEN");
		expect(
			await code(
				restricted.setCommentThreadResolved({ path: abs, threadId: threads[0].id, resolved: true }),
			),
		).toBe("FORBIDDEN");
		expect((await restricted.getDocComments({ path: abs })).threads).toEqual(threads);
		const foreign = caller({ origin: "https://evil.example", host: "localhost:3000" });
		expect(await code(foreign.addCommentThread({ path: abs, anchor: ANCHOR, body: "x" }))).toBe(
			"FORBIDDEN",
		);
		expect(await code(foreign.getDocComments({ path: abs }))).toBe("OK");
	});
});
