import * as fc from "fast-check";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeDocChange } from "../../src/http/doc-change.js";
import { isWatchIgnored } from "../../src/http/watch-signals.js";
import { isIgnoredDir } from "../../src/listing/tree.js";

const plainSegment = fc
	.stringMatching(/^[a-z][a-z0-9-]{0,7}$/)
	.filter((name) => name !== "node_modules" && !isIgnoredDir(name));
const hiddenSegment = plainSegment.map((name) => `.${name}`);
const skippedSegment = fc.oneof(hiddenSegment, fc.constant("node_modules"));
const ext = fc.constantFrom(".md", ".mdx", ".MD", ".png");

describe("isWatchIgnored properties", () => {
	it("skips everything below a hidden or node_modules segment, and nothing else", () => {
		fc.assert(
			fc.property(
				fc.array(fc.oneof(plainSegment, hiddenSegment), { minLength: 1, maxLength: 3 }),
				fc.array(plainSegment, { maxLength: 2 }),
				skippedSegment,
				fc.array(fc.oneof(plainSegment, skippedSegment), { maxLength: 3 }),
				ext,
				(rootSegs, before, skipped, after, extension) => {
					const roots = [{ name: "r", dir: "/" + rootSegs.join("/") }];
					const plain = path.join(roots[0]!.dir, ...before, "file" + extension);
					const below = path.join(roots[0]!.dir, ...before, skipped, ...after, "file" + extension);
					expect(isWatchIgnored(roots, plain)).toBe(false);
					expect(isWatchIgnored(roots, below)).toBe(true);
				},
			),
		);
	});

	it("never skips a file whose change would signal its doc", () => {
		fc.assert(
			fc.property(
				fc.array(fc.oneof(plainSegment, hiddenSegment), { minLength: 1, maxLength: 3 }),
				fc.array(fc.oneof(plainSegment, skippedSegment), { minLength: 1, maxLength: 4 }),
				ext,
				(rootSegs, relSegs, extension) => {
					const roots = [{ name: "r", dir: "/" + rootSegs.join("/") }];
					const file = path.join(roots[0]!.dir, ...relSegs) + extension;
					if (describeDocChange(roots, file) !== null) {
						expect(isWatchIgnored(roots, file)).toBe(false);
					}
				},
			),
		);
	});

	it("does not depend on the order of the roots", () => {
		fc.assert(
			fc.property(
				fc.array(fc.oneof(plainSegment, hiddenSegment), { minLength: 1, maxLength: 2 }),
				fc.array(fc.oneof(plainSegment, skippedSegment), { minLength: 1, maxLength: 2 }),
				fc.array(fc.oneof(plainSegment, skippedSegment), { maxLength: 3 }),
				ext,
				(outerSegs, innerSegs, fileSegs, extension) => {
					const outer = { name: "outer", dir: "/" + outerSegs.join("/") };
					const inner = { name: "inner", dir: path.join(outer.dir, ...innerSegs) };
					const file = path.join(inner.dir, ...fileSegs, "file" + extension);
					const alone = isWatchIgnored([inner], file);
					expect(isWatchIgnored([outer, inner], file)).toBe(alone);
					expect(isWatchIgnored([inner, outer], file)).toBe(alone);
				},
			),
		);
	});
});
