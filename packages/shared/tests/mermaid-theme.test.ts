import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
	MERMAID_TOKEN_FALLBACKS,
	mermaidThemeVariables,
	type MermaidToken,
} from "../mermaid-theme.js";

/** What the web client's `themeVariables()` returned with every token unset, before the move. */
const BEFORE_THE_MOVE = {
	background: "#ffffff",
	primaryColor: "#e8f6f5",
	primaryBorderColor: "#2ba5a2",
	primaryTextColor: "#085b59",
	lineColor: "#a9a8a0",
	textColor: "#2b2a27",
	fontFamily: "Manrope, sans-serif",
	secondaryColor: "#f6f6f3",
	secondaryBorderColor: "#cfcec7",
	secondaryTextColor: "#2b2a27",
	tertiaryColor: "#f6f6f3",
	tertiaryBorderColor: "#e3e2dd",
	tertiaryTextColor: "#2b2a27",
	edgeLabelBackground: "#ffffff",
	clusterBkg: "#f6f6f3",
	clusterBorder: "#e3e2dd",
	attributeBackgroundColorOdd: "#ffffff",
	attributeBackgroundColorEven: "#f6f6f3",
	actorBkg: "#e8f6f5",
	actorBorder: "#2ba5a2",
	actorTextColor: "#085b59",
	actorLineColor: "#a9a8a0",
	signalColor: "#2b2a27",
	signalTextColor: "#2b2a27",
	labelBoxBkgColor: "#f6f6f3",
	labelBoxBorderColor: "#e3e2dd",
	labelTextColor: "#2b2a27",
	loopTextColor: "#2b2a27",
	noteBkgColor: "#fbeccd",
	noteBorderColor: "#855603",
	noteTextColor: "#855603",
};

const TOKENS = Object.keys(MERMAID_TOKEN_FALLBACKS) as MermaidToken[];

describe("mermaidThemeVariables", () => {
	it("gives the web client's table when every token falls back", () => {
		expect(mermaidThemeVariables((token) => MERMAID_TOKEN_FALLBACKS[token])).toEqual(
			BEFORE_THE_MOVE,
		);
	});

	it("reads every token at least once", () => {
		const read = new Set<MermaidToken>();
		mermaidThemeVariables((token) => {
			read.add(token);
			return "";
		});
		expect([...read].sort()).toEqual([...TOKENS].sort());
	});

	it("takes every value from the resolver and always gives the same keys", () => {
		const keys = Object.keys(BEFORE_THE_MOVE).sort();
		fc.assert(
			fc.property(fc.dictionary(fc.constantFrom(...TOKENS), fc.string()), (values) => {
				const given = new Set<string>();
				const variables = mermaidThemeVariables((token) => {
					const value = values[token] ?? `fallback ${token}`;
					given.add(value);
					return value;
				});
				expect(Object.keys(variables).sort()).toEqual(keys);
				for (const value of Object.values(variables)) expect(given.has(value)).toBe(true);
			}),
		);
	});
});
