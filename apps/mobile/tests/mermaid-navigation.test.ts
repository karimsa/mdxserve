import { describe, expect, it } from "@jest/globals";
import * as fc from "fast-check";
import { allowsNavigation } from "../src/diagram/navigation";

const PAGE = "file:///var/mobile/Containers/Data/Application/1/Library/Caches/ExponentAsset-1.html";

describe("allowsNavigation", () => {
	it("allows the diagram page itself", () => {
		expect(allowsNavigation(PAGE, PAGE)).toBe(true);
	});

	it.each([
		"https://example.com/",
		"http://localhost:4040/__mdxserve/trpc",
		"about:blank",
		"file:///etc/hosts",
		"file:///var/mobile/Containers/Data/Application/1/Library/Caches/other.html",
		`${PAGE}?x=1`,
		`${PAGE}#top`,
		"javascript:alert(1)",
		"data:text/html,<p>hi</p>",
		"",
	])("refuses %s", (url) => {
		expect(allowsNavigation(url, PAGE)).toBe(false);
	});

	it("refuses every other string", () => {
		fc.assert(
			fc.property(
				fc.oneof(fc.string(), fc.webUrl()).filter((url) => url !== PAGE),
				(url) => {
					expect(allowsNavigation(url, PAGE)).toBe(false);
				},
			),
		);
	});
});
