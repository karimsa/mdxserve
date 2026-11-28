import { describe, expect, it } from "vitest";
import { fieldHeight, FIELD_MAX_HEIGHT, FIELD_MIN_HEIGHT } from "../src/comments/drafts";
import { layoutPins, pinLeft } from "../src/comments/pins";

describe("reply field", () => {
	it("grows between one line and 120px", () => {
		expect(fieldHeight(0)).toBe(FIELD_MIN_HEIGHT);
		expect(fieldHeight(24.2)).toBe(25);
		expect(fieldHeight(500)).toBe(FIELD_MAX_HEIGHT);
	});
});

describe("gutter counters", () => {
	it("centres a pin on its line", () => {
		expect(layoutPins([{ id: "a", top: 100, height: 30 }], 22, 4)).toEqual([{ id: "a", top: 104 }]);
	});

	it("keeps pins apart, in top-to-bottom order", () => {
		const placed = layoutPins(
			[
				{ id: "low", top: 110, height: 22 },
				{ id: "high", top: 100, height: 22 },
				{ id: "far", top: 400, height: 22 },
			],
			22,
			4,
		);
		expect(placed.map((pin) => pin.id)).toEqual(["high", "low", "far"]);
		expect(placed[1].top - placed[0].top).toBeGreaterThanOrEqual(26);
		expect(placed[2].top).toBe(400);
	});

	it("places the pin beside the column, inside the viewport", () => {
		expect(pinLeft(800, 44, 1200)).toBe(808);
		expect(pinLeft(1190, 44, 1200)).toBe(1148);
		expect(pinLeft(0, 44, 10)).toBe(0);
	});
});

describe("pending sends", () => {
	it("adds and removes a key, and returns the same set when nothing changes", async () => {
		const { pendingReplyKey, withPendingSend } = await import("../src/comments/state");
		const key = pendingReplyKey("/docs/a.md", "t1");
		expect(key).not.toBe(pendingReplyKey("/docs/b.md", "t1"));
		const empty: ReadonlySet<string> = new Set();
		expect(withPendingSend(empty, key, false)).toBe(empty);
		const one = withPendingSend(empty, key, true);
		expect(one.has(key)).toBe(true);
		expect(withPendingSend(one, key, true)).toBe(one);
		expect(withPendingSend(one, key, false).has(key)).toBe(false);
	});
});
