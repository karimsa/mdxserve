import { describe, expect, it } from "@jest/globals";
import { SPRINGS } from "@mdxserve/ui/tokens/springs";
import { rowMotion } from "../src/library/ListMotion";

describe("how list rows move", () => {
	it("moves rows that stay, and enters and leaves rows, without Reduce Motion", () => {
		const motion = rowMotion(false);
		expect(motion.layout).toBeDefined();
		expect(motion.entering).toBeDefined();
		expect(motion.exiting).toBeDefined();
	});

	it("with Reduce Motion, moves nothing and swaps the scale keyframes for plain fades", () => {
		const reduced = rowMotion(true);
		const full = rowMotion(false);
		expect(reduced.layout).toBeUndefined();
		expect(reduced.entering).not.toBe(full.entering);
		expect(reduced.exiting).not.toBe(full.exiting);
	});

	it("uses the web client's glide spring", () => {
		expect(SPRINGS.glide).toEqual({ stiffness: 340, damping: 30, mass: 0.9 });
	});
});
