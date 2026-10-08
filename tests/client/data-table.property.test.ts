import { expect, it } from "vitest";
import { assert, property, integer, array } from "fast-check";
import {
	compareValues,
	filterPredicate,
	parseBound,
	type Column,
} from "../../client/data-table/model";

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
