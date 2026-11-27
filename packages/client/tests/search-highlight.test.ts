import { describe, expect, it } from "vitest";
import { assert, array, property, string } from "fast-check";
import { highlightParts } from "../search-highlight";

describe("highlightParts", () => {
	it("marks every case-insensitive occurrence, longest term first", () => {
		expect(highlightParts("Deploy the deployment", ["deploy", "deployment"])).toEqual([
			{ text: "Deploy", match: true },
			{ text: " the ", match: false },
			{ text: "deployment", match: true },
		]);
	});

	it("treats terms as text, not patterns", () => {
		expect(highlightParts("a.b and axb", ["a.b"])).toEqual([
			{ text: "a.b", match: true },
			{ text: " and axb", match: false },
		]);
	});

	it("returns the text as one plain run with no terms", () => {
		expect(highlightParts("plain", [])).toEqual([{ text: "plain", match: false }]);
		expect(highlightParts("plain", undefined)).toEqual([{ text: "plain", match: false }]);
		expect(highlightParts("", ["x"])).toEqual([]);
	});

	it("always joins back to the text it was given", () => {
		assert(
			property(string(), array(string(), { maxLength: 4 }), (text, terms) => {
				expect(
					highlightParts(text, terms)
						.map((part) => part.text)
						.join(""),
				).toBe(text);
			}),
			{ numRuns: 300 },
		);
	});
});
