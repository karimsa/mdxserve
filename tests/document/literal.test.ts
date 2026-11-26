import { describe, expect, it } from "vitest";
import { foldProgram, literalProgram } from "../../src/document/literal.js";
import { programOf } from "./estree.js";

function fold(expression: string) {
	return foldProgram(programOf(expression));
}

describe("foldProgram", () => {
	it.each<[string, unknown]>([
		['"text"', "text"],
		["'single'", "single"],
		["42", 42],
		["-3.5", -3.5],
		["+7", 7],
		["0x10", 16],
		["-0", 0],
		["true", true],
		["false", false],
		["null", null],
		["`plain template`", "plain template"],
		["`escaped \\${not} an expression`", "escaped ${not} an expression"],
		["[]", []],
		["[1, 'two', [3]]", [1, "two", [3]]],
		["{}", {}],
		['{ label: "Mon", "p 50": 42, 3: true }', { label: "Mon", "p 50": 42, "3": true }],
		["{ nested: { list: [{ deep: null }] } }", { nested: { list: [{ deep: null }] } }],
		["{ a: 1, a: 2 }", { a: 2 }],
	])("folds %s", (expression, expected) => {
		expect(fold(expression)).toEqual({ kind: "literal", value: expected });
	});

	it.each([
		"1 + 1",
		"foo",
		"meta.title",
		"new Date()",
		"undefined",
		"Infinity",
		"NaN",
		"1e999",
		"-x",
		"- -1",
		"!true",
		"`a ${b} c`",
		"tag`text`",
		"[1, , 2]",
		"[...items]",
		"{ ...rest }",
		"{ shorthand }",
		"{ method() {} }",
		"{ get value() { return 1 } }",
		"{ [computed]: 1 }",
		"{ __proto__: { polluted: true } }",
		'{ "__proto__": 1 }',
		"(value) => value",
		"/regex/",
		"10n",
		"<b>jsx</b>",
		"1, 2",
	])("does not fold %s", (expression) => {
		expect(fold(expression)).toEqual({ kind: "non-literal" });
	});

	it("reports a comment-only expression as empty", () => {
		expect(fold("/* a note */")).toEqual({ kind: "empty" });
		expect(fold("")).toEqual({ kind: "empty" });
	});

	it("treats a missing program as non-literal", () => {
		expect(foldProgram(undefined)).toEqual({ kind: "non-literal" });
	});
});

describe("literalProgram", () => {
	it("builds a program that folds back to the same value", () => {
		const value = {
			label: "Mon",
			values: [1, -2, 3.5],
			ok: true,
			none: null,
			nested: { "a b": "c" },
		};
		expect(foldProgram(literalProgram(value))).toEqual({ kind: "literal", value });
	});
});
