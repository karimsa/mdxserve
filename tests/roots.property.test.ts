import path from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { isInside, pruneNestedRoots } from "../src/roots.js";

// Absolute paths built from a tiny alphabet so nesting and duplicates are common.
const segment = fc.constantFrom("a", "b", "c");
const absPath = fc
	.array(segment, { minLength: 1, maxLength: 4 })
	.map((segs) => path.join("/", ...segs));
const rootsArb = fc.array(absPath, { minLength: 0, maxLength: 8 });

describe("pruneNestedRoots", () => {
	it("returns no root that is inside another returned root", () => {
		fc.assert(
			fc.property(rootsArb, (roots) => {
				const kept = pruneNestedRoots(roots);
				for (const a of kept) for (const b of kept) expect(a !== b && isInside(a, b)).toBe(false);
			}),
		);
	});

	it("keeps every outermost root and covers every dropped one", () => {
		fc.assert(
			fc.property(rootsArb, (roots) => {
				const kept = pruneNestedRoots(roots);
				for (const root of roots) {
					const isOutermost = !roots.some((other) => other !== root && isInside(other, root));
					if (isOutermost) expect(kept).toContain(root);
					else expect(kept.some((k) => isInside(k, root))).toBe(true);
				}
			}),
		);
	});

	it("returns each root at most once and preserves first-seen order", () => {
		fc.assert(
			fc.property(rootsArb, (roots) => {
				const kept = pruneNestedRoots(roots);
				expect(new Set(kept).size).toBe(kept.length);
				const firstIndex = kept.map((k) => roots.indexOf(k));
				expect([...firstIndex].sort((x, y) => x - y)).toEqual(firstIndex);
			}),
		);
	});
});
