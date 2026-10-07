import { describe, it } from "vitest";
import fc from "fast-check";
import { expect } from "vitest";
import { runValidate, type ValidateJsonEntry } from "../../src/cli/validate.js";
import { validationResultSchema } from "../../src/validation/controller.js";
import type { Diagnostic, ValidationResult } from "../../src/validation/validate.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { fakeLiveServer } from "../helpers/remote.js";

const diagnosticArb: fc.Arbitrary<Diagnostic> = fc.record({
	severity: fc.constantFrom("error" as const, "warning" as const),
	code: fc.constantFrom(
		"mdx-compile" as const,
		"unknown-component" as const,
		"unknown-prop" as const,
	),
	message: fc.string({ minLength: 1, maxLength: 20 }).filter((text) => !text.includes("\n")),
});

const resultArb: fc.Arbitrary<ValidationResult> = fc
	.record({
		diagnostics: fc.array(diagnosticArb, { maxLength: 4 }),
		rendered: fc.boolean(),
		hints: fc.array(fc.constantFrom("hint a", "hint b"), { maxLength: 2 }),
	})
	.map(({ diagnostics, rendered, hints }) => ({
		ok: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
		path: "/p.md",
		diagnostics,
		rendered,
		hints,
	}));

function run(results: ValidationResult[], json: boolean) {
	let call = 0;
	const server = fakeLiveServer({
		remote: {
			validateDoc: async () => ({ kind: "ok", value: results[call++] }),
		},
	});
	const inputs = results.map((_, index) => `/doc-${index}.md`);
	return runValidate(inputs, { json }, { registry, server, cwd: "/", home: "/home" });
}

describe("runValidate properties", () => {
	it("exits 1 iff some result has an error-severity diagnostic", async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(resultArb, { minLength: 1, maxLength: 4 }), async (results) => {
				const outcome = await run(results, false);
				const hasError = results.some((result) =>
					result.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
				);
				expect(outcome.exitCode).toBe(hasError ? 1 : 0);
			}),
			{ numRuns: 50 },
		);
	});

	it("every json entry round-trips validationResultSchema, one per input", async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(resultArb, { minLength: 1, maxLength: 4 }), async (results) => {
				const outcome = await run(results, true);
				const entries = JSON.parse(outcome.stdout[0]) as ValidateJsonEntry[];
				expect(entries).toHaveLength(results.length);
				for (const [index, entry] of entries.entries()) {
					expect(validationResultSchema.parse(entry)).toEqual(results[index]);
				}
			}),
			{ numRuns: 50 },
		);
	});

	it("prints one block per input", async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(resultArb, { minLength: 1, maxLength: 4 }), async (results) => {
				const outcome = await run(results, false);
				const blocks = outcome.stdout[0].split("\n\n");
				expect(blocks).toHaveLength(results.length);
			}),
			{ numRuns: 50 },
		);
	});
});
