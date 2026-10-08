import { it, expect } from "vitest";
import { assert, asyncProperty, constantFrom, integer } from "fast-check";
import { fixture, input } from "./fixture.js";
it("an explicit provider is never changed", async () => {
	await assert(
		asyncProperty(constantFrom("codex" as const, "claude" as const), async (provider) => {
			const test = fixture();
			try {
				test.preferences.set(provider);
				expect(await test.service.convert(input, true)).toMatchObject({
					kind: "ok",
					value: { provider },
				});
			} finally {
				test.cleanup();
			}
		}),
		{ numRuns: 10 },
	);
});
it("cancelled revisions cannot resurrect", async () => {
	await assert(
		asyncProperty(integer({ min: 2, max: 1000 }), async (revision) => {
			const test = fixture();
			try {
				test.service.cancel(input.session, revision, true);
				expect((await test.service.convert({ ...input, revision: revision - 1 }, true)).kind).toBe(
					"cancelled",
				);
				expect(test.port.convert).not.toHaveBeenCalled();
			} finally {
				test.cleanup();
			}
		}),
		{ numRuns: 20 },
	);
});
