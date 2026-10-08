import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
	dependencyRoots,
	getPackageRoot,
	missingBuildArtifact,
	readPackageVersion,
} from "../../src/infra/pkg.js";

const segmentArb = fc.constantFrom("alpha", "beta", "gamma", "node_modules", "mdxserve");
const prefixArb = fc
	.array(segmentArb, { minLength: 0, maxLength: 4 })
	.map((segments) => path.join(path.sep, ...segments));
const plainSegmentArb = fc.constantFrom("alpha", "beta", "gamma");

describe("dependencyRoots", () => {
	it("returns absolute node_modules dirs, led by the package's own", () => {
		fc.assert(
			fc.property(prefixArb, (pkgRoot) => {
				const roots = dependencyRoots(pkgRoot);
				expect(roots.length).toBeGreaterThanOrEqual(1);
				expect(roots.length).toBeLessThanOrEqual(2);
				expect(roots[0]).toBe(path.join(pkgRoot, "node_modules"));
				for (const root of roots) {
					expect(path.isAbsolute(root)).toBe(true);
					expect(path.basename(root)).toBe("node_modules");
				}
			}),
		);
	});

	it("includes the hosting node_modules when the package sits inside one", () => {
		fc.assert(
			fc.property(prefixArb, (base) => {
				const hosting = path.join(base, "node_modules");
				expect(dependencyRoots(path.join(hosting, "mdxserve"))).toContain(hosting);
			}),
		);
	});

	it("returns only the package's own node_modules otherwise", () => {
		fc.assert(
			fc.property(prefixArb, plainSegmentArb, (base, parent) => {
				expect(dependencyRoots(path.join(base, parent, "mdxserve"))).toHaveLength(1);
			}),
		);
	});
});

describe("readPackageVersion", () => {
	it("matches the version in package.json", () => {
		const manifest = JSON.parse(
			fs.readFileSync(path.join(getPackageRoot(), "package.json"), "utf8"),
		) as { version: string };
		expect(readPackageVersion()).toBe(manifest.version);
	});
});

describe("missingBuildArtifact", () => {
	it("tells both installed and source-checkout users what to do", () => {
		const message = missingBuildArtifact("dist/registry.json");
		expect(message).toContain("dist/registry.json");
		expect(message).toContain("npm i -g @karimsa/mdxserve");
		expect(message).toContain("yarn build");
	});
});
