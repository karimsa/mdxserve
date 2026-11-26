import { describe, expect, it } from "vitest";
import { settleSheet, sheetSnapHeights } from "../../client/ui/sheet-snap";

const VIEWPORT = 800;
const [peek, half, full] = sheetSnapHeights(VIEWPORT);

describe("settleSheet", () => {
	it("rests at the snap nearest to where the sheet was let go", () => {
		expect(settleSheet(half + 20, 0, VIEWPORT)).toBe(half);
		expect(settleSheet(full - 30, 0, VIEWPORT)).toBe(full);
		expect(settleSheet(peek + 10, 0, VIEWPORT)).toBe(peek);
	});

	it("carries a flick on to the next snap in its direction", () => {
		expect(settleSheet(half + 20, 1500, VIEWPORT)).toBe(full);
		expect(settleSheet(half - 20, -800, VIEWPORT)).toBe(peek);
	});

	it("closes when dragged well below the lowest snap", () => {
		expect(settleSheet(peek * 0.4, 0, VIEWPORT)).toBe("close");
	});

	it("closes on a downward flick from the lowest snap", () => {
		expect(settleSheet(peek, -1200, VIEWPORT)).toBe("close");
	});

	it("never rests taller than the tallest snap", () => {
		expect(settleSheet(full, 5000, VIEWPORT)).toBe(full);
	});
});
