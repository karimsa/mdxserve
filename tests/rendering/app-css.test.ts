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
	it("imports the given CSS, scans client/ only, and never scans src/", () => {
		fc.assert(
			fc.property(absPathArb, absPathArb, (tailwindCss, clientDir) => {
				const css = renderAppCss({ tailwindCss, clientDir });
				expect(css).toContain(`@import "${toPosix(tailwindCss)}"`);
				expect(css).toContain(`@import "${toPosix(clientDir)}/app.css"`);
				expect(css).not.toContain('/src"');
				expect(countSources(css)).toBe(1);
				expect(css).not.toContain("@source not");
			}),
		);
	});
});
