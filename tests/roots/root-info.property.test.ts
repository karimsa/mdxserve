import path from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { isInside, pruneNestedRoots } from "../../src/roots/root-info.js";

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
				for (const outer of kept)
					for (const inner of kept) expect(outer !== inner && isInside(outer, inner)).toBe(false);
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
					else expect(kept.some((keptRoot) => isInside(keptRoot, root))).toBe(true);
				}
			}),
		);
	});

	it("returns each root at most once and preserves first-seen order", () => {
		fc.assert(
			fc.property(rootsArb, (roots) => {
				const kept = pruneNestedRoots(roots);
				expect(new Set(kept).size).toBe(kept.length);
				const firstIndex = kept.map((keptRoot) => roots.indexOf(keptRoot));
				expect([...firstIndex].sort((first, second) => first - second)).toEqual(firstIndex);
			}),
		);
	});
});
