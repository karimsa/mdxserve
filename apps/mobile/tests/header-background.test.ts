import { describe, expect, it } from "@jest/globals";
import { assert, double, property } from "fast-check";
import { barBackgroundOpacity } from "../src/header";

describe("the header background's opacity as the bar minimizes", () => {
	it("is whole for the whole bar and gone for the minimized one (folded iPhone Duo: 82 to 24)", () => {
		expect(barBackgroundOpacity(82, 82, 0)).toBe(1);
		expect(barBackgroundOpacity(24, 82, 0)).toBe(0);
	});

	it("is whole when the bar has no room to shrink", () => {
		expect(barBackgroundOpacity(44, 44, 44)).toBe(1);
	});

	it("stays between 0 and 1 and never grows as the bar shrinks", () => {
		assert(
			property(
				double({ min: 0, max: 80, noNaN: true }),
				double({ min: 1, max: 200, noNaN: true }),
				double({ min: 0, max: 1, noNaN: true }),
				double({ min: 0, max: 1, noNaN: true }),
				(top, room, first, second) => {
					const tallest = top + room;
					const [lower, higher] = [Math.min(first, second), Math.max(first, second)];
					const small = barBackgroundOpacity(top + room * lower, tallest, top);
					const large = barBackgroundOpacity(top + room * higher, tallest, top);
					expect(small).toBeGreaterThanOrEqual(0);
					expect(large).toBeLessThanOrEqual(1);
					expect(small).toBeLessThanOrEqual(large);
				},
			),
		);
	});
});
