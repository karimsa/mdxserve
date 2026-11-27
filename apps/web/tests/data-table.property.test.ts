import { expect, it } from "vitest";
import { assert, property, integer, array, double, string } from "fast-check";
import {
	compareValues,
	filterPredicate,
	formatValue,
	parseBound,
	type Column,
} from "@mdxserve/ui/data-table/model";
import { columnWidths } from "@mdxserve/ui/data-table/layout";

it("numeric sorting preserves all values and produces monotonic order", () => {
	assert(
		property(array(integer()), (values) => {
			const sorted = [...values].sort((left, right) => compareValues(left, right, false));
			expect(sorted).toHaveLength(values.length);
			for (let index = 1; index < sorted.length; index++)
				expect(sorted[index]).toBeGreaterThanOrEqual(sorted[index - 1]);
			expect([...sorted].sort((left, right) => compareValues(left, right, true))).toEqual(
				[...sorted].reverse(),
			);
		}),
	);
});
it("inclusive numeric filtering agrees with the mathematical interval", () => {
	assert(
		property(integer(), integer(), integer(), (first, second, value) => {
			const lower = Math.min(first, second);
			const upper = Math.max(first, second);
			const column: Column = { key: "number", label: "Number", type: "number" };
			expect(filterPredicate(column, { min: String(lower), max: String(upper) })(value)).toBe(
				value >= lower && value <= upper,
			);
		}),
	);
});
it("duration bounds represent the same amount across display units", () => {
	assert(
		property(integer({ min: -1000000, max: 1000000 }), (seconds) => {
			const column: Column = { key: "duration", label: "Duration", type: "time", unit: "ms" };
			expect(parseBound(String(seconds), column, "s")).toBe(seconds * 1000);
			expect(parseBound(`${seconds}s`, column, "h")).toBe(seconds * 1000);
		}),
	);
});
it("currency formatting is total over finite numbers and always shows the symbol", () => {
	assert(
		property(double({ noNaN: true, noDefaultInfinity: true, min: -1e12, max: 1e12 }), (value) => {
			const column: Column = { key: "cost", label: "Cost", type: "currency", currency: "USD" };
			expect(formatValue(value, column)).toContain("$");
		}),
	);
});

it("the app's grid sizes every column within bounds, never narrower for longer text", () => {
	const column: Column = { key: "name", label: "Name", type: "text" };
	assert(
		property(array(string()), string(), (values, extra) => {
			const data = values.map((name) => ({ name }));
			const [width] = columnWidths([column], data, {});
			expect(width).toBeGreaterThanOrEqual(72);
			expect(width).toBeLessThanOrEqual(240);
			const [wider] = columnWidths([column], [...data, { name: `${extra}${values.join("")}` }], {});
			expect(wider).toBeGreaterThanOrEqual(width);
		}),
	);
});
