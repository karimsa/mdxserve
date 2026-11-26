import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Root, RootContent } from "mdast";
import type { MdxJsxAttribute, MdxJsxExpressionAttribute } from "mdast-util-mdx";
import { foldProgram } from "../../src/document/literal.js";
import {
	isAllowedHref,
	restrictTree,
	SUPPORTED_ELEMENTS,
	TABLE_ELEMENTS,
	type RestrictDiagnostic,
} from "../../src/document/restrict.js";
import { fixtureComponentNames } from "../fixtures/registry.js";
import { programOf } from "./estree.js";

// ---- Arbitrary mdast trees ------------------------------------------------
// Built directly (not parsed), so they reach shapes a parser would not
// produce: JSX anywhere, expressions with no ESTree, attributes of every kind.

const expressionSources = [
	'"text"',
	"42",
	"-1",
	"true",
	"null",
	"[1, 2]",
	'{ a: "b" }',
	"`template`",
	"/* comment */",
	"1 + 1",
	"meta.title",
	"fn()",
	"`a ${b}`",
	"[...rest]",
];
const programArb = fc.oneof(
	fc.constantFrom(...expressionSources).map((source) => ({ source, estree: programOf(source) })),
	fc.constant({ source: "missing", estree: undefined }),
);

const tagNameArb = fc.constantFrom<string | null>(
	null,
	...fixtureComponentNames,
	"Button",
	"Dropdown",
	"Option",
	"Counter",
	"Callout.Foo",
	...SUPPORTED_ELEMENTS,
	...TABLE_ELEMENTS,
	"div",
	"p",
	"script",
	"style",
	"iframe",
	"svg:rect",
);

const attributeNameArb = fc.constantFrom(
	"title",
	"tone",
	"href",
	"src",
	"open",
	"id",
	"colspan",
	"className",
	"class",
	"style",
	"onClick",
	"onload",
	"target",
	"data-x",
);

const hrefArb = fc.constantFrom(
	"https://example.com",
	"mailto:a@b.c",
	"./doc.md",
	"#anchor",
	"javascript:alert(1)",
	"java\tscript:alert(1)",
	"data:text/html,x",
	"",
);

const attributeArb: fc.Arbitrary<MdxJsxAttribute | MdxJsxExpressionAttribute> = fc.oneof(
	fc.record({
		type: fc.constant("mdxJsxAttribute" as const),
		name: attributeNameArb,
		value: fc.oneof(
			fc.constant(null),
			hrefArb,
			programArb.map(({ source, estree }) => ({
				type: "mdxJsxAttributeValueExpression" as const,
				value: source,
				data: { estree },
			})),
		),
	}),
	programArb.map(({ source, estree }) => ({
		type: "mdxJsxExpressionAttribute" as const,
		value: `...${source}`,
		data: { estree },
	})),
);

const textArb = fc
	.stringMatching(/^[a-z ]{1,8}$/)
	.map((value) => ({ type: "text" as const, value }));

const { flow } = fc.letrec<{ flow: RootContent; phrasing: RootContent }>((tie) => ({
	phrasing: fc.oneof(
		{ depthSize: "small", withCrossShrink: true },
		textArb,
		programArb.map(({ source, estree }) => ({
			type: "mdxTextExpression" as const,
			value: source,
			data: { estree },
		})),
		fc.record({
			type: fc.constant("mdxJsxTextElement" as const),
			name: tagNameArb,
			attributes: fc.array(attributeArb, { maxLength: 3 }),
			children: fc.array(tie("phrasing"), { maxLength: 3 }),
		}),
		fc.record({
			type: fc.constant("emphasis" as const),
			children: fc.array(tie("phrasing"), { maxLength: 3 }),
		}),
		fc.record({
			type: fc.constant("link" as const),
			url: hrefArb,
			children: fc.array(tie("phrasing"), { maxLength: 2 }),
		}),
	) as fc.Arbitrary<RootContent>,
	flow: fc.oneof(
		{ depthSize: "small", withCrossShrink: true },
		fc.record({
			type: fc.constant("paragraph" as const),
			children: fc.array(tie("phrasing"), { maxLength: 4 }),
		}),
		fc.constantFrom('import A from "./a"', "export const b = 1").map((value) => ({
			type: "mdxjsEsm" as const,
			value,
			data: { estree: undefined },
		})),
		programArb.map(({ source, estree }) => ({
			type: "mdxFlowExpression" as const,
			value: source,
			data: { estree },
		})),
		fc.record({
			type: fc.constant("mdxJsxFlowElement" as const),
			name: tagNameArb,
			attributes: fc.array(attributeArb, { maxLength: 3 }),
			children: fc.array(tie("flow"), { maxLength: 3 }),
		}),
		fc.record({
			type: fc.constant("blockquote" as const),
			children: fc.array(tie("flow"), { maxLength: 3 }),
		}),
		hrefArb.map((url) => ({ type: "definition" as const, identifier: "ref", label: "ref", url })),
	) as fc.Arbitrary<RootContent>,
}));

const treeArb: fc.Arbitrary<Root> = fc
	.array(flow, { maxLength: 6 })
	.map((children) => ({ type: "root", children }));

// ---- Properties ---------------------------------------------------------

const components = new Set(fixtureComponentNames);
const supported = new Set(SUPPORTED_ELEMENTS);
const tableParts = new Set(TABLE_ELEMENTS);
const ALLOWED: Record<string, string[]> = {
	abbr: ["title"],
	details: ["open", "id"],
	a: ["href", "title"],
	img: ["src", "alt", "title", "width", "height"],
	th: ["colspan", "rowspan", "align"],
	td: ["colspan", "rowspan", "align"],
};

function run(tree: Root): RestrictDiagnostic[] {
	const diagnostics: RestrictDiagnostic[] = [];
	restrictTree(tree, {
		components: fixtureComponentNames,
		onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
	});
	return diagnostics;
}

/** Every problem left in `tree`; empty when the document rules hold. */
function violations(tree: Root): string[] {
	const found: string[] = [];
	const visit = (node: Root | RootContent, insideTable: boolean) => {
		let childInsideTable = insideTable;
		if (
			node.type === "mdxjsEsm" ||
			node.type === "mdxFlowExpression" ||
			node.type === "mdxTextExpression"
		) {
			found.push(`${node.type} survived`);
		}
		if ((node.type === "link" || node.type === "definition") && !isAllowedHref(node.url)) {
			found.push(`href ${JSON.stringify(node.url)} survived`);
		}
		if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
			const name = node.name;
			const lowercase = name !== null && /^[a-z]/.test(name);
			const allowedTag =
				name !== null &&
				(lowercase
					? supported.has(name) || (insideTable && tableParts.has(name))
					: components.has(name));
			if (!allowedTag) found.push(`tag ${String(name)} survived`);
			if (name === "table") childInsideTable = true;
			for (const attribute of node.attributes) {
				if (attribute.type !== "mdxJsxAttribute") {
					found.push("spread survived");
					continue;
				}
				if (/^(className|class|style)$|^on/i.test(attribute.name)) {
					found.push(`${attribute.name} survived`);
				}
				if (lowercase && name && !(ALLOWED[name] ?? []).includes(attribute.name)) {
					found.push(`${attribute.name} on ${name} survived`);
				}
				const value = attribute.value;
				if (
					value &&
					typeof value === "object" &&
					foldProgram(value.data?.estree).kind !== "literal"
				) {
					found.push(`non-literal ${attribute.name} survived`);
				}
				if (
					name === "a" &&
					attribute.name === "href" &&
					typeof value === "string" &&
					!isAllowedHref(value)
				) {
					found.push(`href ${JSON.stringify(value)} survived`);
				}
			}
		}
		if ("children" in node) for (const child of node.children) visit(child, childInsideTable);
	};
	visit(tree, false);
	return found;
}

describe("restrictTree (properties)", () => {
	it("leaves no ESM, no expression, no tag outside the registry and the supported elements, and no forbidden attribute", () => {
		fc.assert(
			fc.property(treeArb, (tree) => {
				run(tree);
				expect(violations(tree)).toEqual([]);
			}),
		);
	});

	it("is idempotent: a restricted tree has nothing left to report or change", () => {
		fc.assert(
			fc.property(treeArb, (tree) => {
				run(tree);
				const once = structuredClone(tree);
				expect(run(tree)).toEqual([]);
				expect(tree).toEqual(once);
			}),
		);
	});

	it("reports an error for every ESM node and every non-literal it removes", () => {
		fc.assert(
			fc.property(treeArb, (tree) => {
				let esm = 0;
				let removedExpressions = 0;
				const count = (node: Root | RootContent, reachable: boolean) => {
					if (!reachable) return;
					if (node.type === "mdxjsEsm") esm += 1;
					if (
						(node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") &&
						foldProgram(node.data?.estree).kind === "non-literal"
					) {
						removedExpressions += 1;
					}
					// script/style drop their content unreported, so stop counting below them.
					const dropsChildren =
						(node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
						(node.name === "script" || node.name === "style");
					if ("children" in node) for (const child of node.children) count(child, !dropsChildren);
				};
				count(tree, true);
				const diagnostics = run(tree);
				expect(
					diagnostics.filter((diagnostic) => diagnostic.code === "esm-not-supported").length,
				).toBe(esm);
				expect(
					diagnostics.filter(
						(diagnostic) =>
							diagnostic.code === "non-literal-expression" && diagnostic.prop === undefined,
					).length,
				).toBeGreaterThanOrEqual(removedExpressions);
			}),
		);
	});
});
