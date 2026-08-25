import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cacheKeyFor, getCacheDir, getCacheHome } from "../../src/infra/cache.js";

const segment = fc
	.string({ minLength: 1, maxLength: 300 })
	.filter((name) => !name.includes("/") && !name.includes("\0") && name !== "." && name !== "..");
const absPath = fc
	.array(segment, { minLength: 1, maxLength: 6 })
	.map((parts) => "/" + parts.join("/"));

describe("cache key properties", () => {
	it("is a function of the absolute path: relative and absolute spellings agree", () => {
		fc.assert(
			fc.property(absPath, (abs) => {
				const relative = path.relative(process.cwd(), abs);
				expect(cacheKeyFor(relative)).toBe(cacheKeyFor(abs));
				expect(cacheKeyFor(abs + "/")).toBe(cacheKeyFor(abs));
				expect(cacheKeyFor(abs + "/./")).toBe(cacheKeyFor(abs));
			}),
		);
	});

	it("distinct absolute paths get distinct keys", () => {
		fc.assert(
			fc.property(absPath, absPath, (first, second) => {
				fc.pre(path.resolve(first) !== path.resolve(second));
				expect(cacheKeyFor(first)).not.toBe(cacheKeyFor(second));
			}),
		);
	});

	it("the key is a single safe path segment and the dir sits directly under the cache home", () => {
		fc.assert(
			fc.property(absPath, (abs) => {
				const key = cacheKeyFor(abs);
				expect(key).toMatch(/^[A-Za-z0-9._-]+-[0-9a-f]{16}$/);
				expect(Buffer.byteLength(key)).toBeLessThanOrEqual(255);
				expect(path.dirname(getCacheDir(abs))).toBe(getCacheHome());
				expect(getCacheDir(abs).startsWith(path.resolve(abs) + path.sep)).toBe(false);
			}),
		);
	});
});
