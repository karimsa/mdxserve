import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext } from "../helpers/context.js";

const createCaller = createCallerFactory(appRouter);

let root: string;
let abs: string;
let original: string;

beforeAll(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-comments-ctl-prop-")));
	abs = path.join(root, "doc.md");
	original = "# Doc\n\nHello world\n";
	await fs.writeFile(abs, original, "utf8");
});

afterAll(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

const okAnchor = { heading: "Doc", block: "Hello world", quote: "world" };

const badAnchorArb = fc.oneof(
	fc.record({ ...asArbs(okAnchor), heading: fc.string({ minLength: 301, maxLength: 320 }) }),
	fc.record({ ...asArbs(okAnchor), block: fc.string({ minLength: 501, maxLength: 520 }) }),
	fc.record({ ...asArbs(okAnchor), quote: fc.string({ minLength: 501, maxLength: 520 }) }),
	fc.record({ ...asArbs(okAnchor), quote: fc.constant("") }),
	fc.record({ ...asArbs(okAnchor), block: fc.constant("   \n ") }),
);

function asArbs<Value extends Record<string, string>>(value: Value) {
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [key, fc.constant(entry)]),
	) as {
		[Key in keyof Value]: fc.Arbitrary<Value[Key]>;
	};
}

describe("comments controller input limits", () => {
	it("rejects anchors and bodies outside the limits without touching the file", async () => {
		const api = createCaller(makeContext(root, registry));
		await fc.assert(
			fc.asyncProperty(
				fc.oneof(
					badAnchorArb.map((anchor) => ({ anchor, body: "ok" })),
					fc.record({
						anchor: fc.constant(okAnchor),
						body: fc.oneof(fc.constant(""), fc.string({ minLength: 4001, maxLength: 4100 })),
					}),
				),
				async (input) => {
					await expect(api.addCommentThread({ path: abs, ...input })).rejects.toMatchObject({
						code: "BAD_REQUEST",
					});
					expect(await fs.readFile(abs, "utf8")).toBe(original);
				},
			),
			{ numRuns: 40 },
		);
	});

	it("rejects ids that do not match the id pattern", async () => {
		const api = createCaller(makeContext(root, registry));
		await fc.assert(
			fc.asyncProperty(
				fc.oneof(
					fc.constant(""),
					fc.string({ minLength: 65, maxLength: 70 }),
					fc.constant("a b"),
					fc.constant("a/b"),
				),
				async (id) => {
					await expect(
						api.addCommentReply({ path: abs, threadId: id, body: "x" }),
					).rejects.toMatchObject({ code: "BAD_REQUEST" });
					await expect(
						api.setCommentThreadResolved({ path: abs, threadId: id, resolved: true }),
					).rejects.toMatchObject({ code: "BAD_REQUEST" });
				},
			),
			{ numRuns: 30 },
		);
	});
});
