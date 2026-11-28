import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The full screen view's bar icons (scripts/render-bar-icons.mjs): one size for all, so the
// vertical bar's items match one another, at each of the three screen scales.

const directory = path.join(__dirname, "../assets/bar-icons");
const NAMES = [
	"plus",
	"maximize",
	"minus",
	"arrow-down",
	"arrow-up",
	"arrow-left",
	"arrow-right",
	"code",
	"x",
];

/** A PNG's width and height, from its header. */
function size(file: string) {
	const bytes = readFileSync(path.join(directory, file));
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("the diagram view's bar icons", () => {
	it.each(NAMES)("are %s at 22 pt in 1×, 2× and 3×", (name) => {
		expect(size(`${name}.png`)).toEqual({ width: 22, height: 22 });
		expect(size(`${name}@2x.png`)).toEqual({ width: 44, height: 44 });
		expect(size(`${name}@3x.png`)).toEqual({ width: 66, height: 66 });
	});

	it("are only those the script renders and the view uses", () => {
		const used = readFileSync(path.join(__dirname, "../src/diagram/bar-icons.ts"), "utf8");
		const script = readFileSync(path.join(__dirname, "../scripts/render-bar-icons.mjs"), "utf8");
		for (const name of NAMES) {
			expect(used).toContain(`bar-icons/${name}.png`);
			expect(script).toContain(`"${name}"`);
		}
		expect(readdirSync(directory).sort()).toEqual(
			NAMES.flatMap((name) => [`${name}.png`, `${name}@2x.png`, `${name}@3x.png`]).sort(),
		);
	});
});
