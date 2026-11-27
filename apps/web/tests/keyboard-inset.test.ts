import { describe, expect, it } from "vitest";
import { coveredBottom } from "../src/hooks";

describe("coveredBottom", () => {
	it("is zero when the visual viewport fills the layout viewport", () => {
		expect(coveredBottom(800, 0, 800)).toBe(0);
	});

	it("is the keyboard's height when it shrinks the visual viewport", () => {
		expect(coveredBottom(800, 0, 460)).toBe(340);
	});

	it("shrinks by however far the visual viewport has scrolled down", () => {
		expect(coveredBottom(800, 120, 460)).toBe(220);
	});

	it("never goes negative when the browser chrome collapses", () => {
		expect(coveredBottom(800, 0, 860)).toBe(0);
	});
});
