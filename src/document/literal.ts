import type { Expression, Program, Property, SpreadElement } from "estree";

/** A JSON value: what a document may write inside braces. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type FoldResult = { kind: "literal"; value: Json } | { kind: "non-literal" };

/** The result of folding the program MDX attaches to a brace expression. */
export type ProgramFoldResult = FoldResult | { kind: "empty" };

const NON_LITERAL: FoldResult = { kind: "non-literal" };

/**
 * Fold an ESTree expression to the JSON value it denotes, or report it as
 * non-literal. Accepted: a string, number, boolean or null `Literal`; an
 * `ArrayExpression` with no holes and no spread; an `ObjectExpression` of plain
 * `key: value` pairs whose key is an identifier, string or number; a unary `-`
 * or `+` on a numeric literal; and a `TemplateLiteral` with no expressions.
 * Everything else, including a number that is not finite and a `__proto__`
 * key (which a JS object literal would treat as a prototype, not a key), is
 * non-literal.
 */
export function foldExpression(node: Expression | SpreadElement): FoldResult {
	switch (node.type) {
		case "Literal": {
			if (isRegexOrBigint(node)) return NON_LITERAL;
			const value = node.value;
			if (value === null || typeof value === "string" || typeof value === "boolean") {
				return { kind: "literal", value };
			}
			if (typeof value === "number") return foldNumber(value);
			return NON_LITERAL;
		}
		case "UnaryExpression": {
			if (node.operator !== "-" && node.operator !== "+") return NON_LITERAL;
			const argument = node.argument;
			if (argument.type !== "Literal" || typeof argument.value !== "number") return NON_LITERAL;
			return foldNumber(node.operator === "-" ? -argument.value : argument.value);
		}
		case "TemplateLiteral": {
			if (node.expressions.length > 0 || node.quasis.length !== 1) return NON_LITERAL;
			const cooked = node.quasis[0].value.cooked;
			return typeof cooked === "string" ? { kind: "literal", value: cooked } : NON_LITERAL;
		}
		case "ArrayExpression": {
			const items: Json[] = [];
			for (const element of node.elements) {
				if (element === null || element.type === "SpreadElement") return NON_LITERAL;
				const folded = foldExpression(element);
				if (folded.kind !== "literal") return NON_LITERAL;
				items.push(folded.value);
			}
			return { kind: "literal", value: items };
		}
		case "ObjectExpression": {
			const result: { [key: string]: Json } = {};
			for (const property of node.properties) {
				if (property.type !== "Property") return NON_LITERAL;
				const key = propertyKey(property);
				if (key === undefined) return NON_LITERAL;
				const folded = foldExpression(property.value as Expression);
				if (folded.kind !== "literal") return NON_LITERAL;
				result[key] = folded.value;
			}
			return { kind: "literal", value: result };
		}
		default:
			return NON_LITERAL;
	}
}

/** A regex or bigint literal, whose `value` can be null when the runtime lacks support. */
function isRegexOrBigint(node: Expression): boolean {
	const fields = node as { regex?: unknown; bigint?: unknown };
	return Boolean(fields.regex) || fields.bigint !== undefined;
}

function foldNumber(value: number): FoldResult {
	if (!Number.isFinite(value)) return NON_LITERAL;
	// `-0` has no JSON form; it serializes (and reads back) as 0.
	return { kind: "literal", value: value === 0 ? 0 : value };
}

function propertyKey(property: Property): string | undefined {
	if (property.kind !== "init" || property.method || property.shorthand || property.computed) {
		return undefined;
	}
	const key = property.key;
	let name: string | undefined;
	if (key.type === "Identifier") name = key.name;
	else if (key.type === "Literal" && !isRegexOrBigint(key)) {
		if (typeof key.value === "string") name = key.value;
		else if (typeof key.value === "number" && Number.isFinite(key.value)) name = String(key.value);
	}
	return name === "__proto__" ? undefined : name;
}

/**
 * Fold the program that MDX attaches to a brace expression (`data.estree`).
 * A program with no statements (an empty `{}` or a comment such as
 * `{/* note *\/}`) is `empty`; one expression statement folds as above; any
 * other program, or a missing one, is non-literal.
 */
export function foldProgram(program: Program | undefined | null): ProgramFoldResult {
	if (!program) return NON_LITERAL;
	if (program.body.length === 0) return { kind: "empty" };
	if (program.body.length !== 1) return NON_LITERAL;
	const statement = program.body[0];
	if (statement.type !== "ExpressionStatement") return NON_LITERAL;
	return foldExpression(statement.expression);
}

/** Build the ESTree expression for a JSON value, the inverse of `foldExpression`. */
export function literalExpression(value: Json): Expression {
	if (Array.isArray(value)) {
		return { type: "ArrayExpression", elements: value.map(literalExpression) };
	}
	if (value !== null && typeof value === "object") {
		return {
			type: "ObjectExpression",
			properties: Object.entries(value).map(([key, item]): Property => ({
				type: "Property",
				key: { type: "Literal", value: key, raw: JSON.stringify(key) },
				value: literalExpression(item),
				kind: "init",
				method: false,
				shorthand: false,
				computed: false,
			})),
		};
	}
	if (typeof value === "number" && value < 0) {
		return {
			type: "UnaryExpression",
			operator: "-",
			prefix: true,
			argument: { type: "Literal", value: -value, raw: String(-value) },
		};
	}
	return { type: "Literal", value, raw: JSON.stringify(value) };
}

/** A program holding one expression statement for `value`, in the shape MDX attaches to an expression. */
export function literalProgram(value: Json): Program {
	return {
		type: "Program",
		sourceType: "module",
		body: [{ type: "ExpressionStatement", expression: literalExpression(value) }],
		comments: [],
	};
}
