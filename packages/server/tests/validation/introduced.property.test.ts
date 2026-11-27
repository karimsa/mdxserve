import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { introducedErrors } from "../../src/validation/introduced.js";
import type { Diagnostic } from "../../src/validation/validate.js";

const messageTemplateArb = fc.constantFrom(
	"Heading repeats; first on line {1}",
	"The section starting on line {1} is shown as source. Fix the syntax at line {2}.",
	"Lines {1}, {2} have a problem",
	"Unknown component Calout",
	"Add id to <Tabs>",
	"Seen across line {1}-{2}",
);

const diagnosticArb: fc.Arbitrary<Diagnostic> = fc
	.record({
		severity: fc.constantFrom<Diagnostic["severity"]>("error", "warning"),
		code: fc.constantFrom<Diagnostic["code"]>(
			"mdx-syntax",
			"missing-id",
			"duplicate-heading",
			"unknown-component",
		),
		template: messageTemplateArb,
		first: fc.integer({ min: 1, max: 500 }),
		second: fc.integer({ min: 1, max: 500 }),
		line: fc.option(fc.integer({ min: 1, max: 500 }), { nil: undefined }),
	})
	.map(({ severity, code, template, first, second, line }) => ({
		severity,
		code,
		message: template.replace("{1}", String(first)).replace("{2}", String(second)),
		line,
	}));

const diagnosticsArb = fc.array(diagnosticArb, { maxLength: 8 });

function errorsOf(diagnostics: Diagnostic[]): Diagnostic[] {
	return diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}

/** The same diagnostics with every line number in message and `line` moved. */
function shifted(diagnostics: Diagnostic[], by: number): Diagnostic[] {
	return diagnostics.map((diagnostic) => ({
		...diagnostic,
		line: diagnostic.line === undefined ? undefined : diagnostic.line + by,
		message: diagnostic.message.replace(/\d+/g, (digits) => String(Number(digits) + by)),
	}));
}

describe("introducedErrors properties", () => {
	it("introducedErrors(x, x) is empty", () => {
		fc.assert(
			fc.property(diagnosticsArb, (diagnostics) => {
				expect(introducedErrors(diagnostics, diagnostics)).toEqual([]);
			}),
		);
	});

	it("only returns error-severity members of after, and never more than after has", () => {
		fc.assert(
			fc.property(diagnosticsArb, diagnosticsArb, (before, after) => {
				const introduced = introducedErrors(before, after);
				expect(introduced.length).toBeLessThanOrEqual(errorsOf(after).length);
				for (const diagnostic of introduced) {
					expect(diagnostic.severity).toBe("error");
					expect(after).toContain(diagnostic);
				}
			}),
		);
	});

	it("adding diagnostics to before never grows the result", () => {
		fc.assert(
			fc.property(diagnosticsArb, diagnosticsArb, diagnosticsArb, (before, extra, after) => {
				const small = introducedErrors(before, after).length;
				const large = introducedErrors([...before, ...extra], after).length;
				expect(large).toBeLessThanOrEqual(small);
			}),
		);
	});

	it("is empty when after's errors are all in before", () => {
		fc.assert(
			fc.property(diagnosticsArb, diagnosticsArb, (before, extra) => {
				expect(introducedErrors([...before, ...extra], errorsOf(before))).toEqual([]);
			}),
		);
	});

	it("shifting every line number, or reordering after, does not change how many errors are new", () => {
		fc.assert(
			fc.property(
				diagnosticsArb,
				diagnosticsArb,
				fc.integer({ min: 0, max: 400 }),
				(before, after, by) => {
					const baseline = introducedErrors(before, after).length;
					expect(introducedErrors(before, shifted(after, by)).length).toBe(baseline);
					expect(introducedErrors(shifted(before, by), after).length).toBe(baseline);
					expect(introducedErrors(before, [...after].reverse()).length).toBe(baseline);
				},
			),
		);
	});

	it("warnings never appear, whatever before holds", () => {
		fc.assert(
			fc.property(diagnosticsArb, diagnosticsArb, (before, after) => {
				const warningsOnly = after.map((diagnostic) => ({
					...diagnostic,
					severity: "warning" as const,
				}));
				expect(introducedErrors(before, warningsOnly)).toEqual([]);
			}),
		);
	});

	it("an error with no counterpart in before is always returned", () => {
		fc.assert(
			fc.property(diagnosticsArb, (before) => {
				const novel: Diagnostic = {
					severity: "error",
					code: "invalid-prop",
					message: "never produced by the generator",
				};
				expect(introducedErrors(before, [novel])).toEqual([novel]);
			}),
		);
	});
});
