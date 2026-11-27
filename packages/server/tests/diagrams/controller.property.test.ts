import { it, expect } from "vitest";
import { assert, property, string, integer } from "fast-check";
import { convertDiagramInput } from "../../src/diagrams/controller.js";
import { input } from "./fixture.js";
it("rejects invalid revisions and never accepts oversized text", () => {
	assert(
		property(integer({ max: 0 }), string(), (revision, text) => {
			expect(convertDiagramInput.safeParse({ ...input, revision, text }).success).toBe(false);
		}),
	);
	expect(convertDiagramInput.safeParse({ ...input, text: "x".repeat(16001) }).success).toBe(false);
});
