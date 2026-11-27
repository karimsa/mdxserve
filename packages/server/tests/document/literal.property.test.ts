import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { foldProgram, type Json } from "../../src/document/literal.js";
import { programOf } from "./estree.js";

// JSON values with no `__proto__` key: a JS object literal treats that key as
// the prototype, so `literal.ts` refuses it (see the unit tests).
const jsonArb: fc.Arbitrary<Json> = fc
	.jsonValue()
	.filter((value) => !JSON.stringify(value).includes('"__proto__"')) as fc.Arbitrary<Json>;

/** Print `value` as JS source, choosing among the literal spellings with `choices`. */
function print(value: Json, choices: fc.Stream<number>): string {
	const pick = (count: number) => (choices.next().value as number) % count;
	if (value === null || typeof value === "boolean") return String(value);
	if (typeof value === "number")
		return pick(2) === 0 ? String(value) : `${value < 0 ? "" : "+"}${value}`;
	if (typeof value === "string") {
		const inner = JSON.stringify(value).slice(1, -1);
		switch (pick(3)) {
			case 0:
				return `"${inner}"`;
			case 1:
				return `'${inner.replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
			default:
				return `\`${inner.replace(/\\"/g, '"').replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\``;
		}
	}
	if (Array.isArray(value)) return `[${value.map((item) => print(item, choices)).join(", ")}]`;
	const entries = Object.entries(value).map(([key, item]) => {
		const name = /^[A-Za-z_$][\w$]*$/.test(key) && pick(2) === 0 ? key : JSON.stringify(key);
		return `${name}: ${print(item, choices)}`;
	});
	return `{ ${entries.join(", ")} }`;
}

const choicesArb = fc.infiniteStream(fc.nat());

const nonLiteralArb = fc.constantFrom(
	"x",
	"1 + 1",
	"meta.title",
	"fn()",
	"undefined",
	"Infinity",
	"`a ${b}`",
	"(() => 1)",
	"!0",
	"[...rest]",
	"{ shorthand }",
	"{ [key]: 1 }",
	"/re/",
	"1n",
);

describe("foldProgram (properties)", () => {
	it("a folded literal equals JSON.parse(JSON.stringify(value))", () => {
		fc.assert(
			fc.property(jsonArb, choicesArb, (value, choices) => {
				const source = print(value, choices);
				expect(foldProgram(programOf(source))).toEqual({
					kind: "literal",
					value: JSON.parse(JSON.stringify(value)),
				});
			}),
		);
	});

	it("a literal with a non-literal anywhere inside never folds", () => {
		fc.assert(
			fc.property(
				jsonArb,
				nonLiteralArb,
				fc.array(fc.constantFrom("array", "object"), { maxLength: 4 }),
				choicesArb,
				(value, hole, wrappers, choices) => {
					let source: string = hole;
					for (const wrapper of wrappers) {
						const sibling = print(value, choices);
						source =
							wrapper === "array" ? `[${sibling}, ${source}]` : `{ a: ${sibling}, b: ${source} }`;
					}
					expect(foldProgram(programOf(source))).toEqual({ kind: "non-literal" });
				},
			),
		);
	});
});
