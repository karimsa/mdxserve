import fc from "fast-check";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describeDocChange } from "../../src/http/doc-change.js";

const segment = fc
	.stringMatching(/^[a-z][a-z0-9-]{0,7}$/)
	.filter((name) => name !== "node_modules");
const ext = fc.constantFrom(".md", ".mdx", ".MD");

describe("describeDocChange properties", () => {
	it("every servable doc under a root round-trips to root + rel", () => {
		fc.assert(
			fc.property(
				fc.array(segment, { minLength: 1, maxLength: 3 }),
				fc.array(segment, { minLength: 1, maxLength: 4 }),
				ext,
				(rootSegs, relSegs, extension) => {
					const dir = "/" + rootSegs.join("/");
					const rel = relSegs.join("/") + extension;
					const result = describeDocChange([{ name: "r", dir }], path.join(dir, rel));
					expect(result).toEqual({ path: path.join(dir, rel), root: "r", rel });
				},
			),
		);
	});

	it("never attributes a file to a root that is not one of its ancestors", () => {
		fc.assert(
			fc.property(
				fc.array(segment, { minLength: 1, maxLength: 3 }),
				fc.array(segment, { minLength: 1, maxLength: 4 }),
				(rootSegs, fileSegs) => {
					const roots = [{ name: "r", dir: "/" + rootSegs.join("/") }];
					const file = "/" + fileSegs.join("/") + ".md";
					const result = describeDocChange(roots, file);
					const inside = file.startsWith(roots[0]!.dir + "/");
					expect(result !== null).toBe(inside);
					if (result) expect(path.join(result.path)).toBe(path.join(roots[0]!.dir, result.rel));
				},
			),
		);
	});
});
