import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { spliceLines } from "../../src/docs/edit.js";

// Printable ASCII, no \r or \n by construction — exactly the "line" alphabet
// the property descriptions call for.
const lineArb = fc.stringMatching(/^[ -~]{0,20}$/);
const eolArb = fc.constantFrom<"\n" | "\r\n">("\n", "\r\n");

// A line array whose *last* element isn't "" — joining with a separator and
// no explicit trailing separator is otherwise genuinely ambiguous with a
// shorter array plus a trailing separator (["a", ""].join("\n") === "a\n" ===
// ["a"].join("\n") + "\n"), and spliceLines' own canonicalisation (split,
// then drop a trailing empty element) always resolves that ambiguity toward
// the shorter-array-plus-trailing-EOL reading. Excluding it here keeps each
// generated case's intended (lines, trailingEol) the one spliceLines will
// actually see.
function linesArb(minLength: number, maxLength: number) {
	return fc
		.array(lineArb, { minLength, maxLength })
		.filter((lines) => lines.length === 0 || lines[lines.length - 1] !== "");
}

/**
 * Decompose a text into (lines, eol, trailingEol) the same way spliceLines'
 * spec describes — used as the test's oracle for "what lines does this text
 * have" and "did it end with a newline", independent of spliceLines' own
 * internals for line indexing.
 */
function decompose(text: string): { lines: string[]; eol: "\n" | "\r\n"; trailingEol: boolean } {
	const eol = text.includes("\r\n") ? "\r\n" : "\n";
	const trailingEol = /\r?\n$/.test(text);
	let lines = text === "" ? [] : text.split(/\r?\n/);
	if (trailingEol) lines = lines.slice(0, -1);
	return { lines, eol, trailingEol };
}

/** Same normalisation spliceLines applies to a replacement. */
function normalizeReplacement(replacement: string): string {
	return replacement.replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

function replacementLineCount(replacement: string): number {
	return normalizeReplacement(replacement).split("\n").length;
}

// spliceLines strips trailing newlines from the replacement (so a caller
// can't smuggle a meaningless trailing blank through it), and — when the
// edited range reaches the true end of the file — an entirely-blank
// replacement's one contributed empty line becomes the new last element of
// the whole line array, which is the same "trailing separator" ambiguity
// `linesArb` excludes from generated inputs, now arising from the output
// side instead. Both are genuine, spec'd consequences of "strip trailing
// newlines" / "an empty replacement contributes one empty line" — not bugs —
// so property tests that check exact line-for-line/trailing-EOL behavior
// skip these two shapes rather than asserting something the algorithm was
// never meant to guarantee.
function replacementEndsBlank(replacement: string): boolean {
	return normalizeReplacement(replacement) === "";
}

// A text with at least 2 lines (so EOL choice is always observable in the
// join), a chosen EOL style, optional trailing EOL, and a valid [start, end]
// range within it.
const caseArb = fc
	.tuple(linesArb(2, 10), eolArb, fc.boolean())
	.chain(([lines, eol, trailingEol]) => {
		const text = lines.join(eol) + (trailingEol ? eol : "");
		return fc
			.tuple(fc.integer({ min: 1, max: lines.length }), fc.integer({ min: 1, max: lines.length }))
			.map(([oneLine, otherLine]) => ({
				lines,
				eol,
				trailingEol,
				text,
				start: Math.min(oneLine, otherLine),
				end: Math.max(oneLine, otherLine),
			}));
	});

const caseWithReplacementArb = caseArb.chain((base) =>
	fc.array(lineArb, { minLength: 0, maxLength: 5 }).map((replLines) => ({
		...base,
		replacement: replLines.join("\n"),
	})),
);

describe("spliceLines — identity", () => {
	it("splicing [s, e] with exactly its own lines is the identity", () => {
		fc.assert(
			fc.property(caseArb, ({ text, start, end, lines }) => {
				// If the slice's own last line is itself blank, feeding it back in
				// as a replacement hits the same "strip trailing newlines" rule as
				// replacementEndsBlank below — not a real round-trip case.
				fc.pre(lines[end - 1] !== "");
				const own = lines.slice(start - 1, end).join("\n");
				expect(spliceLines(text, start, end, own)).toEqual({ ok: true, text });
			}),
		);
	});
});

describe("spliceLines — outside-range invariance and EOL preservation", () => {
	it("lines before start and after end are unchanged; EOL and trailing-newline state are preserved", () => {
		fc.assert(
			fc.property(caseWithReplacementArb, (testCase) => {
				const { text, start, end, lines, eol, trailingEol, replacement } = testCase;
				fc.pre(!(end === lines.length && replacementEndsBlank(replacement)));
				const result = spliceLines(text, start, end, replacement);
				expect(result.ok).toBe(true);
				if (!result.ok) return;

				const out = decompose(result.text);
				expect(out.trailingEol).toBe(trailingEol);
				// EOL is only observable in the output when there's at least one
				// separator to inspect (>1 line) or a trailing one was appended;
				// with a single, non-trailing-EOL line, no byte in the output could
				// possibly distinguish "\n" from "\r\n", so there's nothing to assert.
				if (out.lines.length > 1 || out.trailingEol) expect(out.eol).toBe(eol);

				expect(out.lines.slice(0, start - 1)).toEqual(lines.slice(0, start - 1));
				const sufLen = lines.length - end;
				expect(out.lines.slice(out.lines.length - sufLen)).toEqual(lines.slice(end));
			}),
		);
	});
});

describe("spliceLines — counting", () => {
	it("output line count = input - (end - start + 1) + replacement line count", () => {
		fc.assert(
			fc.property(caseWithReplacementArb, ({ text, start, end, lines, replacement }) => {
				fc.pre(!(end === lines.length && replacementEndsBlank(replacement)));
				const result = spliceLines(text, start, end, replacement);
				expect(result.ok).toBe(true);
				if (!result.ok) return;
				const out = decompose(result.text);
				const removed = end - start + 1;
				expect(out.lines.length).toBe(lines.length - removed + replacementLineCount(replacement));
			}),
		);
	});
});

describe("spliceLines — commutation of disjoint splices", () => {
	// Four distinct 1-indexed line numbers, sorted ascending, so the ranges
	// [firstStart, firstEnd] and [secondStart, secondEnd] are disjoint with a
	// gap between them, and offsets from editing the first range are stable
	// when applied to the second.
	const disjointCaseArb = linesArb(4, 10)
		.chain((lines) =>
			fc
				.uniqueArray(fc.integer({ min: 1, max: lines.length }), { minLength: 4, maxLength: 4 })
				.map((nums) => {
					const [firstStart, firstEnd, secondStart, secondEnd] = [...nums].sort(
						(left, right) => left - right,
					);
					return { lines, firstStart, firstEnd, secondStart, secondEnd };
				}),
		)
		.chain(({ lines, firstStart, firstEnd, secondStart, secondEnd }) =>
			fc
				.tuple(
					fc.array(lineArb, { minLength: 0, maxLength: 4 }),
					fc.array(lineArb, { minLength: 0, maxLength: 4 }),
				)
				.map(([repl1, repl2]) => ({
					lines,
					firstStart,
					firstEnd,
					secondStart,
					secondEnd,
					repl1: repl1.join("\n"),
					repl2: repl2.join("\n"),
				})),
		);

	it("splicing the later range first equals splicing the earlier one first, with the later range shifted", () => {
		fc.assert(
			fc.property(
				disjointCaseArb,
				({ lines, firstStart, firstEnd, secondStart, secondEnd, repl1, repl2 }) => {
					const text = lines.join("\n");

					const step1 = spliceLines(text, secondStart, secondEnd, repl2);
					expect(step1.ok).toBe(true);
					if (!step1.ok) return;
					const orderA = spliceLines(step1.text, firstStart, firstEnd, repl1);
					expect(orderA.ok).toBe(true);

					const step2 = spliceLines(text, firstStart, firstEnd, repl1);
					expect(step2.ok).toBe(true);
					if (!step2.ok) return;
					const delta = replacementLineCount(repl1) - (firstEnd - firstStart + 1);
					const orderB = spliceLines(step2.text, secondStart + delta, secondEnd + delta, repl2);
					expect(orderB.ok).toBe(true);

					if (orderA.ok && orderB.ok) expect(orderA.text).toBe(orderB.text);
				},
			),
		);
	});
});

describe("spliceLines — out of range", () => {
	it("property: an invalid [start, end] never throws and always reports ok: false", () => {
		fc.assert(
			fc.property(
				fc.array(lineArb, { minLength: 0, maxLength: 6 }),
				fc.oneof(fc.integer({ min: -5, max: 10 }), fc.double()),
				fc.oneof(fc.integer({ min: -5, max: 10 }), fc.double()),
				fc.string(),
				(lines, start, end, replacement) => {
					const text = lines.join("\n");
					let result;
					expect(() => {
						result = spliceLines(text, start, end, replacement);
					}).not.toThrow();
					const valid =
						Number.isInteger(start) &&
						Number.isInteger(end) &&
						start >= 1 &&
						end >= start &&
						end <= lines.length;
					if (!valid) expect(result).toMatchObject({ ok: false });
				},
			),
		);
	});

	it("examples: below-range start, above-range end, inverted range, and a non-integer all fail cleanly", () => {
		const text = "a\nb\nc";
		expect(spliceLines(text, 0, 1, "x").ok).toBe(false);
		expect(spliceLines(text, 1, 4, "x").ok).toBe(false);
		expect(spliceLines(text, 2, 1, "x").ok).toBe(false);
		expect(spliceLines(text, 1.5, 2, "x").ok).toBe(false);
	});
});
