import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { parse } from "yaml";
import { editComments, parseComments } from "../../src/comments/frontmatter.js";
import type { CommentThread } from "../../src/comments/schema.js";

const bodyArb = fc
	.oneof(
		fc.string({ minLength: 1, maxLength: 200 }),
		fc
			.array(
				fc.constantFrom("---", "...", "a: b", "- x", "# c", "", " lead", "tail ", "'", '"', "é🙂"),
				{
					minLength: 1,
					maxLength: 8,
				},
			)
			.map((lines) => lines.join("\n")),
	)
	.filter((text) => text.trim().length > 0);

function threadWith(body: string): CommentThread {
	return {
		id: "t1",
		anchor: { heading: "H", block: "B", quote: "Q" },
		resolved: false,
		messages: [{ id: "m1", author: "human", body }],
	};
}

const keyArb = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/).filter((key) => key !== "comments");
const valueArb = fc.oneof(
	fc.string({ maxLength: 20 }),
	fc.integer(),
	fc.boolean(),
	fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
);

describe("comment frontmatter properties", () => {
	it("any body survives write then parse unchanged", () => {
		fc.assert(
			fc.property(bodyArb, (body) => {
				const edited = editComments(undefined, { kind: "add-thread", thread: threadWith(body) });
				if (edited.kind !== "ok") throw new Error(edited.kind);
				const parsed = parseComments(`---\n${edited.yaml}---\nbody\n`);
				expect(parsed.diagnostics).toEqual([]);
				expect(parsed.threads[0]?.messages[0].body).toBe(body);
			}),
			{ numRuns: 200 },
		);
	});

	it("other keys parse to the same values before and after any edit", () => {
		fc.assert(
			fc.property(
				fc.dictionary(keyArb, valueArb, { maxKeys: 5 }),
				bodyArb,
				fc.constantFrom("add-thread", "reply", "resolve"),
				(others, body, action) => {
					const start = Object.keys(others).length
						? Object.entries(others)
								.map(([key, value]) => `${key}: ${JSON.stringify(value)}\n`)
								.join("")
						: undefined;
					const first = editComments(start, { kind: "add-thread", thread: threadWith("seed") });
					if (first.kind !== "ok") throw new Error(first.kind);
					const edit =
						action === "add-thread"
							? ({ kind: "add-thread", thread: { ...threadWith(body), id: "t2" } } as const)
							: action === "reply"
								? ({
										kind: "add-message",
										threadId: "t1",
										message: { id: "m2", author: "human", body },
									} as const)
								: ({ kind: "set-resolved", threadId: "t1", resolved: true } as const);
					const second = editComments(first.yaml, edit);
					if (second.kind !== "ok") throw new Error(second.kind);
					const strip = (text: string) => {
						const { comments: _comments, ...rest } = parse(text) as Record<string, unknown>;
						return rest;
					};
					expect(strip(second.yaml)).toEqual(strip(first.yaml));
					expect(strip(second.yaml)).toEqual(others);
				},
			),
			{ numRuns: 100 },
		);
	});
});
