import { describe, expect, it } from "vitest";
import {
	autoBinCount,
	binValues,
	countTicks,
	fitLabel,
	formatBinEdge,
	labelColumnWidth,
	niceMax,
	toNumber,
} from "../../client/builtins/chart-data.js";

describe("toNumber", () => {
	it("passes finite numbers through", () => {
		expect(toNumber(42)).toBe(42);
		expect(toNumber("38")).toBe(38);
	});

	it("falls back to 0 for anything non-finite", () => {
		expect(toNumber("x")).toBe(0);
		expect(toNumber(undefined)).toBe(0);
		expect(toNumber(Number.NaN)).toBe(0);
	});
});

describe("niceMax", () => {
	it("rounds up to a leading digit at the value's magnitude", () => {
		expect(niceMax(118)).toBe(200);
		expect(niceMax(31)).toBe(40);
	});

	it("falls back to 1 for non-finite or non-positive input", () => {
		expect(niceMax(0)).toBe(1);
		expect(niceMax(-5)).toBe(1);
		expect(niceMax(Number.NaN)).toBe(1);
	});
});

describe("countTicks", () => {
	it("dedupes ticks that round to the same integer for a small max", () => {
		expect(countTicks(1)).toEqual([0, 1]);
	});

	it("spaces five ticks evenly for a larger max", () => {
		expect(countTicks(200)).toEqual([0, 50, 100, 150, 200]);
	});
});

describe("autoBinCount", () => {
	it("follows Sturges' rule", () => {
		expect(autoBinCount(8)).toBe(4);
		expect(autoBinCount(1000)).toBe(11);
	});

	it("clamps to 20 for a huge sample", () => {
		expect(autoBinCount(1_000_000_000)).toBe(20);
	});
});

describe("formatBinEdge", () => {
	it("rounds off floating-point noise using the step's precision", () => {
		expect(formatBinEdge(0.30000000000000004, 0.1)).toBe("0.3");
	});
});

describe("binValues", () => {
	it("bins into equal-width buckets with the last edge pinned to max", () => {
		const bins = binValues([1, 2, 3, 4], 2);
		expect(bins.map((bin) => bin.start)).toEqual([1, 2.5]);
		expect(bins.map((bin) => bin.end)).toEqual([2.5, 4]);
		expect(bins.map((bin) => bin.value)).toEqual([2, 2]);
	});

	it("returns [] for an empty or all-NaN input", () => {
		expect(binValues([])).toEqual([]);
		expect(binValues([Number.NaN, Number.NaN])).toEqual([]);
	});

	it("returns one bin holding everything for a single value", () => {
		const bins = binValues([7]);
		expect(bins).toHaveLength(1);
		expect(bins[0]?.value).toBe(1);
	});

	it("returns one bin of the full count for a zero-width range", () => {
		const bins = binValues([5, 5, 5, 5]);
		expect(bins).toHaveLength(1);
		expect(bins[0]?.value).toBe(4);
	});

	it("respects an explicit bin count, clamped to 50", () => {
		expect(binValues([1, 2, 3, 4, 5], 3)).toHaveLength(3);
		expect(
			binValues(
				Array.from({ length: 200 }, (_element, index) => index),
				500,
			),
		).toHaveLength(50);
	});
});

describe("labelColumnWidth", () => {
	it("clamps to the given bounds", () => {
		expect(labelColumnWidth(["a"], { fontSize: 10, min: 38, max: 180 })).toBe(38);
		expect(
			labelColumnWidth(["a very long path/name/that/is/way/too/long/for/this"], {
				fontSize: 10,
				min: 38,
				max: 180,
			}),
		).toBe(180);
	});
});

describe("fitLabel", () => {
	it("leaves a label unchanged when it fits", () => {
		expect(fitLabel("short", 200, 10)).toBe("short");
	});

	it("truncates with an ellipsis when it doesn't fit", () => {
		const fitted = fitLabel("example/nested/deep/05-nested-page.md", 40, 10);
		expect(fitted.endsWith("…")).toBe(true);
		expect(fitted.length).toBeLessThan("example/nested/deep/05-nested-page.md".length);
	});
});
