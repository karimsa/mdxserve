import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { modifiedLinkHref } from "../../client/editor-link.js";

const click = (over: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean }> = {}) => ({
	button: 0,
	metaKey: false,
	ctrlKey: false,
	...over,
});

describe("modifiedLinkHref", () => {
	it("returns the href for a cmd+click on a link", () => {
		expect(modifiedLinkHref(click({ metaKey: true }), "https://example.com/x")).toBe(
			"https://example.com/x",
		);
	});

	it("returns the href for a ctrl+click on a link", () => {
		expect(modifiedLinkHref(click({ ctrlKey: true }), "https://example.com/x")).toBe(
			"https://example.com/x",
		);
	});

	it("leaves a plain click alone so the caret can land inside the link text", () => {
		expect(modifiedLinkHref(click(), "https://example.com/x")).toBeNull();
	});

	it("ignores clicks that are not the primary button", () => {
		expect(
			modifiedLinkHref(click({ metaKey: true, button: 1 }), "https://example.com/x"),
		).toBeNull();
		expect(
			modifiedLinkHref(click({ metaKey: true, button: 2 }), "https://example.com/x"),
		).toBeNull();
	});

	it("ignores a modified click that is not on a link", () => {
		expect(modifiedLinkHref(click({ metaKey: true }), null)).toBeNull();
		expect(modifiedLinkHref(click({ metaKey: true }), undefined)).toBeNull();
		expect(modifiedLinkHref(click({ metaKey: true }), "")).toBeNull();
	});

	it("opens only when the primary button carries cmd or ctrl, for any href", () => {
		fc.assert(
			fc.property(
				fc.record({
					button: fc.integer({ min: 0, max: 4 }),
					metaKey: fc.boolean(),
					ctrlKey: fc.boolean(),
				}),
				fc.option(fc.webUrl(), { nil: null }),
				(event, href) => {
					const opens = event.button === 0 && (event.metaKey || event.ctrlKey) && Boolean(href);
					expect(modifiedLinkHref(event, href)).toBe(opens ? href : null);
				},
			),
		);
	});
});
