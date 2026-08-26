import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decodeRoutePath } from "../../client/route-path.js";

describe("decodeRoutePath", () => {
	it("decodes a percent-encoded pathname", () => {
		expect(decodeRoutePath("/docs/My%20Page.md")).toBe("/docs/My Page.md");
		expect(decodeRoutePath("/docs/caf%C3%A9/")).toBe("/docs/café/");
	});

	it("leaves an already-decoded pathname alone", () => {
		expect(decodeRoutePath("/docs/My Page.md")).toBe("/docs/My Page.md");
	});

	it("keeps a pathname with a stray percent sign rather than throwing", () => {
		expect(decodeRoutePath("/docs/100%.md")).toBe("/docs/100%.md");
	});

	it("inverts encodeURI for any path made of unreserved and space characters", () => {
		fc.assert(
			fc.property(
				fc.array(fc.stringMatching(/^[A-Za-z0-9 ._-]{1,12}$/), { minLength: 1, maxLength: 5 }),
				(segments) => {
					const decoded = `/${segments.join("/")}`;
					expect(decodeRoutePath(encodeURI(decoded))).toBe(decoded);
					// Idempotent on the decoded form when it contains no `%`.
					expect(decodeRoutePath(decoded)).toBe(decoded);
				},
			),
		);
	});
});
