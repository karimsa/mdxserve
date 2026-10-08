import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
	autoBinCount,
	binValues,
	countTicks,
	edgeTickIndices,
	fitLabel,
	labelColumnWidth,
	niceMax,
} from "../../client/builtins/chart-data.js";

const finiteValue = fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true });
const maybeNonFiniteValue = fc.oneof(
	finiteValue,
	fc.constant(Number.NaN),
	fc.constant(Number.POSITIVE_INFINITY),
	fc.constant(Number.NEGATIVE_INFINITY),
);
const valuesArbitrary = fc.array(maybeNonFiniteValue, { maxLength: 40 });
const nonEmptyValuesArbitrary = fc
	.tuple(finiteValue, fc.array(maybeNonFiniteValue, { maxLength: 39 }))
	.map(([first, rest]) => [first, ...rest]);
const nonDegenerateValuesArbitrary = fc
	.tuple(finiteValue, finiteValue, fc.array(maybeNonFiniteValue, { maxLength: 38 }))
	.filter(([first, second]) => first !== second)
	.map(([first, second, rest]) => [first, second, ...rest]);
const binCountArbitrary = fc.option(fc.integer({ min: 1, max: 60 }), { nil: undefined });

describe("binValues", () => {
	it("bin counts sum to the number of finite values", () => {
		fc.assert(
			fc.property(valuesArbitrary, binCountArbitrary, (values, binCount) => {
				const finiteCount = values.filter((value) => Number.isFinite(value)).length;
				const bins = binValues(values, binCount);
				const total = bins.reduce((sum, bin) => sum + bin.value, 0);
				expect(total).toBe(finiteCount);
			}),
		);
	});

	it("puts every finite value in exactly one bin's [start, end) range (end inclusive on the last)", () => {
		fc.assert(
			fc.property(nonEmptyValuesArbitrary, binCountArbitrary, (values, binCount) => {
				const bins = binValues(values, binCount);
				const lastBin = bins[bins.length - 1];
				for (const value of values) {
					if (!Number.isFinite(value)) continue;
					const matches = bins.filter((bin) =>
						bin === lastBin
							? value >= bin.start && value <= bin.end
							: value >= bin.start && value < bin.end,
					);
					expect(matches.length).toBe(1);
				}
			}),
		);
	});

	it("has contiguous, monotonic edges spanning [min, max]", () => {
		fc.assert(
			fc.property(nonEmptyValuesArbitrary, binCountArbitrary, (values, binCount) => {
				const finite = values.filter((value) => Number.isFinite(value));
				const bins = binValues(values, binCount);
				expect(bins[0]!.start).toBeCloseTo(Math.min(...finite), 9);
				expect(bins[bins.length - 1]!.end).toBeCloseTo(Math.max(...finite), 9);
				for (const bin of bins) expect(bin.end).toBeGreaterThanOrEqual(bin.start);
				for (let index = 1; index < bins.length; index++) {
					expect(bins[index]!.start).toBeCloseTo(bins[index - 1]!.end, 9);
				}
			}),
		);
	});

	it("uses equal-width bins when the range is non-degenerate", () => {
		fc.assert(
			fc.property(nonDegenerateValuesArbitrary, binCountArbitrary, (values, binCount) => {
				const bins = binValues(values, binCount);
				if (bins.length < 2) return;
				const width = bins[0]!.end - bins[0]!.start;
				const tolerance = Math.abs(width) * 1e-6 + 1e-9;
				for (const bin of bins.slice(0, -1)) {
					expect(Math.abs(bin.end - bin.start - width)).toBeLessThanOrEqual(tolerance);
				}
			}),
		);
	});

	it("respects an explicit bin count (clamped to 50) when non-degenerate, else falls back to autoBinCount", () => {
		fc.assert(
			fc.property(
				nonDegenerateValuesArbitrary,
				fc.integer({ min: 1, max: 80 }),
				(values, requestedBins) => {
					const bins = binValues(values, requestedBins);
					expect(bins.length).toBe(Math.min(50, requestedBins));
				},
			),
		);
		fc.assert(
			fc.property(nonDegenerateValuesArbitrary, (values) => {
				const finiteCount = values.filter((value) => Number.isFinite(value)).length;
				const bins = binValues(values);
				expect(bins.length).toBe(Math.min(50, autoBinCount(finiteCount)));
			}),
		);
	});

	it("collapses a zero-width range to one bin holding every value", () => {
		fc.assert(
			fc.property(finiteValue, fc.integer({ min: 1, max: 20 }), (value, length) => {
				const values = Array.from({ length }, () => value);
				const bins = binValues(values);
				expect(bins).toHaveLength(1);
				expect(bins[0]!.value).toBe(length);
			}),
		);
	});

	it("returns [] for values with no finite entries", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.oneof(
						fc.constant(Number.NaN),
						fc.constant(Number.POSITIVE_INFINITY),
						fc.constant(Number.NEGATIVE_INFINITY),
					),
					{ maxLength: 10 },
				),
				(values) => {
					expect(binValues(values)).toEqual([]);
				},
			),
		);
	});

	it("gives every bin a non-empty label", () => {
		fc.assert(
			fc.property(nonEmptyValuesArbitrary, binCountArbitrary, (values, binCount) => {
				for (const bin of binValues(values, binCount)) expect(bin.label.length).toBeGreaterThan(0);
			}),
		);
	});
});

describe("niceMax", () => {
	it("is >= the input, > 0, with an integer mantissa in [1, 10]", () => {
		fc.assert(
			fc.property(fc.double({ min: 0.0001, max: 1e9, noNaN: true }), (value) => {
				const max = niceMax(value);
				expect(max).toBeGreaterThanOrEqual(value);
				expect(max).toBeGreaterThan(0);
				const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
				const mantissa = max / magnitude;
				expect(Math.abs(mantissa - Math.round(mantissa))).toBeLessThan(1e-6);
				expect(mantissa).toBeGreaterThanOrEqual(1);
				expect(mantissa).toBeLessThanOrEqual(10);
			}),
		);
	});

	// Floating-point rounding near a magnitude boundary (e.g. 0.30000000000000004)
	// can nudge the mantissa up on a second pass, so idempotency is only
	// guaranteed for integer input, not arbitrary floats.
	it("is idempotent on integer input", () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), (value) => {
				const max = niceMax(value);
				expect(niceMax(max)).toBe(max);
			}),
		);
	});
});

describe("countTicks", () => {
	it("is strictly increasing from 0 to max, with at most `desired` ticks", () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0.01, max: 1_000_000, noNaN: true }),
				fc.integer({ min: 2, max: 10 }),
				(max, desired) => {
					const ticks = countTicks(max, desired);
					expect(ticks.length).toBeLessThanOrEqual(desired);
					expect(ticks[0]).toBe(0);
					expect(ticks[ticks.length - 1]).toBe(Math.round(max));
					for (let index = 1; index < ticks.length; index++) {
						expect(ticks[index]).toBeGreaterThan(ticks[index - 1]!);
					}
				},
			),
		);
	});
});

describe("labelColumnWidth", () => {
	it("does not depend on label order", () => {
		fc.assert(
			fc.property(
				fc.array(fc.string({ maxLength: 40 }), { maxLength: 10 }),
				fc.integer({ min: 8, max: 20 }),
				(labels, fontSize) => {
					const bounds = { fontSize, min: 20, max: 300 };
					expect(labelColumnWidth(labels, bounds)).toBe(
						labelColumnWidth([...labels].reverse(), bounds),
					);
				},
			),
		);
	});

	it("stays within [min, max]", () => {
		fc.assert(
			fc.property(
				fc.array(fc.string({ maxLength: 60 }), { maxLength: 10 }),
				fc.integer({ min: 8, max: 20 }),
				fc.integer({ min: 10, max: 60 }),
				fc.integer({ min: 60, max: 400 }),
				(labels, fontSize, min, max) => {
					const width = labelColumnWidth(labels, { fontSize, min, max });
					expect(width).toBeGreaterThanOrEqual(min);
					expect(width).toBeLessThanOrEqual(max);
				},
			),
		);
	});

	it("never shrinks when a longer label is added", () => {
		fc.assert(
			fc.property(
				fc.array(fc.string({ maxLength: 20 }), { maxLength: 8 }),
				fc.string({ minLength: 21, maxLength: 40 }),
				fc.integer({ min: 8, max: 20 }),
				(labels, longerLabel, fontSize) => {
					const bounds = { fontSize, min: 0, max: 1000 };
					const before = labelColumnWidth(labels, bounds);
					const after = labelColumnWidth([...labels, longerLabel], bounds);
					expect(after).toBeGreaterThanOrEqual(before);
				},
			),
		);
	});
});

describe("fitLabel", () => {
	it("returns the label unchanged when it fits, else a prefix of it plus an ellipsis", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1, maxLength: 60 }),
				fc.integer({ min: 5, max: 500 }),
				fc.integer({ min: 6, max: 24 }),
				(label, maxWidth, fontSize) => {
					const fitted = fitLabel(label, maxWidth, fontSize);
					if (fitted === label) {
						expect(label.length * 0.58 * fontSize).toBeLessThanOrEqual(maxWidth);
					} else {
						expect(fitted.endsWith("…")).toBe(true);
						expect(label.startsWith(fitted.slice(0, -1))).toBe(true);
					}
				},
			),
		);
	});
});

describe("edgeTickIndices", () => {
	it("is strictly increasing, includes both ends, and stays in range", () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 200 }),
				fc.integer({ min: 2, max: 20 }),
				(edgeCount, maxLabels) => {
					const indices = edgeTickIndices(edgeCount, maxLabels);
					expect(indices[0]).toBe(0);
					expect(indices[indices.length - 1]).toBe(edgeCount - 1);
					for (let index = 1; index < indices.length; index++) {
						expect(indices[index]).toBeGreaterThan(indices[index - 1]!);
					}
					for (const index of indices) {
						expect(index).toBeGreaterThanOrEqual(0);
						expect(index).toBeLessThan(edgeCount);
					}
				},
			),
		);
	});
});
