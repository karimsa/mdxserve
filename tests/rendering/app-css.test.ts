import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { renderAppCss } from "../../src/rendering/app-css.js";
import { toPosix } from "../../src/infra/paths.js";

const segmentArb = fc.constantFrom("alpha", "beta", "gamma", "pkg", "docs");
const absPathArb = fc
	.array(segmentArb, { minLength: 1, maxLength: 4 })
	.map((segments) => `/${segments.join("/")}`);

describe("renderAppCss", () => {
	it("includes the styles and source paths needed by served docs", () => {
		fc.assert(
			fc.property(
				absPathArb,
				absPathArb,
				fc.array(absPathArb, { maxLength: 4 }),
				fc.array(absPathArb, { maxLength: 4 }),
				(tailwindCss, clientDir, sourceDirs, sourceFiles) => {
					const css = renderAppCss({ tailwindCss, clientDir, sourceDirs, sourceFiles });
					expect(css).toContain(`@import "${toPosix(tailwindCss)}"`);
					expect(css).toContain(`@import "${toPosix(clientDir)}/app.css"`);
					for (const sourceDir of sourceDirs) expect(css).toContain(toPosix(sourceDir));
					for (const sourceFile of sourceFiles) expect(css).toContain(toPosix(sourceFile));
				},
			),
		);
	});
});
