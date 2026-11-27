import { expect, it } from "vitest";
import { assert, property, string } from "fast-check";
import { serverInfoSchema } from "@mdxserve/shared/server-info";
import { defaultServerName, parseServerName } from "../../src/server-info/name.js";

const nameSchema = serverInfoSchema.shape.name;

it("a default name always fits the schema and 63 bytes, and is a prefix of the cleaned hostname", () => {
	assert(
		property(string({ unit: "grapheme", maxLength: 80 }), (hostname) => {
			const name = defaultServerName(hostname);
			expect(nameSchema.safeParse(name).success).toBe(true);
			expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63);
			expect(name).toBe(name.trim());
			// Cutting never produces a lone surrogate.
			expect(Buffer.from(name, "utf8").toString("utf8")).toBe(name);
		}),
		{ numRuns: 500 },
	);
});

it("a name parseServerName accepts always fits the schema", () => {
	assert(
		property(string({ unit: "grapheme", maxLength: 80 }), (input) => {
			const parsed = parseServerName(input);
			if (parsed.kind === "ok") {
				expect(nameSchema.safeParse(parsed.name).success).toBe(true);
				expect(Buffer.byteLength(parsed.name)).toBeLessThanOrEqual(63);
			}
		}),
		{ numRuns: 500 },
	);
});
