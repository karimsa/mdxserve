import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { renderAppCss } from "../../src/rendering/app-css.js";
import { toPosix } from "../../src/infra/paths.js";

const segmentArb = fc.constantFrom("alpha", "beta", "gamma", "pkg", "docs");
const absPathArb = fc
	.array(segmentArb, { minLength: 1, maxLength: 4 })
	.map((segments) => `/${segments.join("/")}`);

/** Counts `@source "…"` and `@source not "…"` directives. */
function countSources(text: string): number {
	return text.match(/@source (not )?"/g)?.length ?? 0;
}

describe("renderAppCss", () => {
	it("imports the given CSS, scans every source, and never scans src/", () => {
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
					expect(css).not.toContain('/src"');
					expect(countSources(css)).toBe(3 * sourceDirs.length + sourceFiles.length + 1);
				},
			),
		);
	});
});
