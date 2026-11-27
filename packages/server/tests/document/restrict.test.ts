import { describe, expect, it } from "vitest";
import type { Root, RootContent } from "mdast";
import type { MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx";
import { toString as mdastToString } from "mdast-util-to-string";
import {
	isAllowedHref,
	proseText,
	restrictTree,
	SUPPORTED_ELEMENTS,
	type RestrictDiagnostic,
} from "../../src/document/restrict.js";
import { foldProgram } from "../../src/document/literal.js";
import { fixtureComponentNames } from "../fixtures/registry.js";
import { parseMdx } from "./estree.js";

function restrict(source: string): { tree: Root; diagnostics: RestrictDiagnostic[] } {
	const tree = parseMdx(source);
	const diagnostics: RestrictDiagnostic[] = [];
	restrictTree(tree, {
		components: fixtureComponentNames,
		onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
	});
	return { tree, diagnostics };
}

function codes(source: string): string[] {
	return restrict(source).diagnostics.map((diagnostic) => diagnostic.code);
}

/** Every JSX element left in the tree, in document order. */
function elements(tree: Root): (MdxJsxFlowElement | MdxJsxTextElement)[] {
	const found: (MdxJsxFlowElement | MdxJsxTextElement)[] = [];
	const visit = (node: Root | RootContent) => {
		if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") found.push(node);
		if ("children" in node) for (const child of node.children) visit(child);
	};
	visit(tree);
	return found;
}

function nodeTypes(tree: Root): string[] {
	const types: string[] = [];
	const visit = (node: Root | RootContent) => {
		types.push(node.type);
		if ("children" in node) for (const child of node.children) visit(child);
	};
	visit(tree);
	return types;
}

describe("restrictTree — ESM", () => {
	it("removes imports and exports and reports one error per statement", () => {
		const { tree, diagnostics } = restrict(
			'import A from "./a"\nexport const b = 1\n\n# Title\n\nexport const c = 2\n',
		);
		expect(nodeTypes(tree)).not.toContain("mdxjsEsm");
		expect(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.line])).toEqual([
			["esm-not-supported", 1],
			["esm-not-supported", 2],
			["esm-not-supported", 6],
		]);
		expect(diagnostics[0].message).toContain("Delete the line");
		expect(mdastToString(tree)).toBe("Title");
	});
});

describe("restrictTree — expressions in prose", () => {
	it.each<[string, string]>([
		['Value: {"text"}', "Value: text"],
		["Value: {42}", "Value: 42"],
		["Value: {-1.5}", "Value: -1.5"],
		["Value: {[1, 2]}", "Value: [1,2]"],
		['Value: {{ a: "b" }}', 'Value: {"a":"b"}'],
		["Value: {true}", "Value: "],
		["Value: {false}", "Value: "],
		["Value: {null}", "Value: "],
		["Value: {/* a comment */}", "Value: "],
	])("renders %s as %j with no diagnostic", (source, text) => {
		const { tree, diagnostics } = restrict(source);
		expect(diagnostics).toEqual([]);
		expect(mdastToString(tree)).toBe(text);
		expect(nodeTypes(tree)).not.toContain("mdxTextExpression");
	});

	it("turns a flow literal into a paragraph", () => {
		const { tree } = restrict('{"standalone"}\n');
		expect(tree.children).toMatchObject([
			{ type: "paragraph", children: [{ type: "text", value: "standalone" }] },
		]);
	});

	it("removes a non-literal and tells the author to write a literal", () => {
		const { tree, diagnostics } = restrict("One plus one is {1 + 1}.\n\n{meta.title}\n");
		expect(mdastToString(tree)).toBe("One plus one is .");
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics[0]).toMatchObject({ code: "non-literal-expression", line: 1, column: 17 });
		expect(diagnostics[0].message).toContain("{1 + 1}");
		expect(diagnostics[0].message).toContain("literal array, object, string or number");
		expect(diagnostics[1]).toMatchObject({ code: "non-literal-expression", line: 3 });
	});
});

describe("restrictTree — attribute expressions", () => {
	it("keeps an attribute whose expression folds to a literal", () => {
		const { tree, diagnostics } = restrict('<Callout title={`Hi`} tone={"warn"} />\n');
		expect(diagnostics).toEqual([]);
		const [callout] = elements(tree);
		const title = callout.attributes[0];
		expect(title.type === "mdxJsxAttribute" && typeof title.value === "object").toBe(true);
		if (title.type !== "mdxJsxAttribute" || typeof title.value !== "object" || !title.value) return;
		expect(foldProgram(title.value.data?.estree)).toEqual({ kind: "literal", value: "Hi" });
	});

	it("drops a non-literal attribute and keeps the element", () => {
		const { tree, diagnostics } = restrict("<Badge tone={props.tone} dot>Shipped</Badge>\n");
		expect(diagnostics).toMatchObject([
			{ code: "non-literal-expression", component: "Badge", prop: "tone" },
		]);
		const [badge] = elements(tree);
		expect(badge.attributes.map((attribute) => "name" in attribute && attribute.name)).toEqual([
			"dot",
		]);
		expect(mdastToString(tree)).toBe("Shipped");
	});

	it("drops a spread attribute", () => {
		const { tree, diagnostics } = restrict("<Callout {...props}>Body</Callout>\n");
		expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["non-literal-expression"]);
		expect(elements(tree)[0].attributes).toEqual([]);
	});
});

describe("restrictTree — components", () => {
	it("unwraps an unknown component, keeps its children and suggests a builtin", () => {
		const { tree, diagnostics } = restrict("<Calout>\n\nInside **bold**.\n\n</Calout>\n");
		expect(elements(tree)).toEqual([]);
		expect(mdastToString(tree)).toBe("Inside bold.");
		expect(diagnostics).toMatchObject([
			{ code: "unknown-component", component: "Calout", suggestions: ["Callout"], line: 1 },
		]);
		expect(diagnostics[0].message).toContain("mdxserve components");
	});

	it("reports className, style, on*, spreads and non-literal values on an unknown component, but not its literal props", () => {
		const { tree, diagnostics } = restrict(
			'<Widget className="box" style={{ color: "red" }} onClick={go} {...rest} title={meta.title} tone="tip" count={2}>Kept</Widget>\n',
		);
		expect(mdastToString(tree)).toBe("Kept");
		expect(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.prop])).toEqual([
			["unknown-component", undefined],
			["unsupported-attribute", "className"],
			["unsupported-attribute", "style"],
			["unsupported-attribute", "onClick"],
			["non-literal-expression", undefined],
			["non-literal-expression", "title"],
		]);
		expect(diagnostics.slice(1).every((diagnostic) => diagnostic.line === 1)).toBe(true);
		expect(diagnostics[1]).toMatchObject({ component: "Widget" });
		expect(diagnostics[1].message).toContain("Remove the attribute");
		expect(diagnostics[5].message).toContain("{meta.title}");
	});

	it("reports the forbidden attributes of a removed component", () => {
		expect(codes('<Button className="x" label="Go">Go</Button>\n')).toEqual([
			"removed-component",
			"unsupported-attribute",
		]);
	});

	it("unwraps a member tag on a builtin", () => {
		expect(codes("<Callout.Foo />\n")).toEqual(["unknown-component"]);
	});

	it.each(["Button", "Dropdown", "Option"])(
		"reports %s as removed and keeps its content",
		(name) => {
			const { tree, diagnostics } = restrict(`<${name} label="x">Kept text</${name}>\n`);
			expect(diagnostics).toMatchObject([{ code: "removed-component", component: name }]);
			expect(diagnostics[0].message).toContain("Tabs");
			expect(elements(tree)).toEqual([]);
			expect(mdastToString(tree)).toBe("Kept text");
		},
	);

	it("keeps builtins and their unknown props (validation warns about those)", () => {
		const { tree, diagnostics } = restrict('<Callout tone="tip" bogus="x">Body</Callout>\n');
		expect(diagnostics).toEqual([]);
		expect(elements(tree)[0].attributes).toHaveLength(2);
	});

	it.each(["className", "style", "onClick", "onload"])("drops %s from a builtin", (name) => {
		const { tree, diagnostics } = restrict(`<Callout ${name}="x" tone="tip">Body</Callout>\n`);
		expect(diagnostics).toMatchObject([
			{ code: "unsupported-attribute", component: "Callout", prop: name },
		]);
		expect(diagnostics[0].message).toContain("Remove the attribute");
		expect(
			elements(tree)[0].attributes.map((attribute) => "name" in attribute && attribute.name),
		).toEqual(["tone"]);
	});
});

describe("restrictTree — lowercase elements", () => {
	it.each(SUPPORTED_ELEMENTS)("keeps <%s>", (tag) => {
		const source =
			tag === "br" || tag === "img" ? `Text <${tag} /> end\n` : `Text <${tag}>in</${tag}> end\n`;
		const { tree, diagnostics } = restrict(source);
		expect(diagnostics).toEqual([]);
		expect(elements(tree).map((element) => element.name)).toEqual([tag]);
	});

	it("unwraps an unsupported element and lists the supported ones", () => {
		const { tree, diagnostics } = restrict("<div>\n\nInside a div.\n\n</div>\n");
		expect(elements(tree)).toEqual([]);
		expect(mdastToString(tree)).toBe("Inside a div.");
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].code).toBe("unsupported-element");
		expect(diagnostics[0].message).toContain("kbd, abbr");
	});

	it("reports each forbidden attribute of an element it unwraps, but not a plain one", () => {
		const { tree, diagnostics } = restrict(
			'<div className="box" onClick={go} title="plain">Text</div>\n',
		);
		expect(mdastToString(tree)).toBe("Text");
		expect(diagnostics).toMatchObject([
			{ code: "unsupported-element" },
			{ code: "unsupported-attribute", prop: "className", component: undefined },
			{ code: "unsupported-attribute", prop: "onClick", component: undefined },
		]);
	});

	it.each(["script", "style"])("removes <%s> with its content", (tag) => {
		const { tree, diagnostics } = restrict(`Before\n\n<${tag}>{"secret"}</${tag}>\n\nAfter\n`);
		expect(mdastToString(tree)).toBe("BeforeAfter");
		expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["unsupported-element"]);
	});

	it("unwraps a fragment", () => {
		const { tree, diagnostics } = restrict("<>Fragment text</>\n");
		expect(mdastToString(tree)).toBe("Fragment text");
		expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["unsupported-element"]);
	});

	it("allows table parts only inside a table", () => {
		const inside = restrict(
			'<table>\n  <thead><tr><th colspan="2">Head</th></tr></thead>\n  <tbody><tr><td align="left">One</td></tr></tbody>\n</table>\n',
		);
		expect(inside.diagnostics).toEqual([]);
		expect(elements(inside.tree).map((element) => element.name)).toEqual([
			"table",
			"thead",
			"tr",
			"th",
			"tbody",
			"tr",
			"td",
		]);

		const outside = restrict("<tr><td>Loose</td></tr>\n");
		expect(outside.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
			"unsupported-element",
			"unsupported-element",
		]);
		expect(outside.diagnostics[0].message).toContain("outside a <table>");
		expect(mdastToString(outside.tree)).toBe("Loose");
	});

	it.each<[string, string[], string[]]>([
		['<abbr title="Hypertext" lang="en">HTML</abbr>', ["title"], ["lang"]],
		[
			'<details open id="more" className="x"><summary>More</summary>Body</details>',
			["open", "id"],
			["className"],
		],
		[
			'<a href="https://example.com" title="Example" target="_blank">x</a>',
			["href", "title"],
			["target"],
		],
		[
			'<img src="a.png" alt="A" title="T" width="10" height={20} loading="lazy" />',
			["src", "alt", "title", "width", "height"],
			["loading"],
		],
		['<span id="x" title="y">text</span>', [], ["id", "title"]],
	])("keeps only allowlisted attributes in %s", (source, kept, dropped) => {
		const { tree, diagnostics } = restrict(`${source}\n`);
		const element = elements(tree)[0];
		expect(element.attributes.map((attribute) => "name" in attribute && attribute.name)).toEqual(
			kept,
		);
		expect(diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.prop])).toEqual(
			dropped.map((name) => ["unsupported-attribute", name]),
		);
	});
});

describe("restrictTree — links", () => {
	it.each([
		"[x](https://example.com)",
		"[x](http://example.com)",
		"[x](mailto:someone@example.com)",
		"[x](./other.md)",
		"[x](../up/other.mdx#part)",
		"[x](#anchor)",
		"[x](/absolute/path)",
	])("keeps %s", (source) => {
		expect(codes(`${source}\n`)).toEqual([]);
	});

	it("clears a javascript: link target and keeps the link text", () => {
		const { tree, diagnostics } = restrict("[click](javascript:alert(1))\n");
		expect(diagnostics).toMatchObject([{ code: "invalid-href", line: 1 }]);
		expect(diagnostics[0].message).toContain("http, https, mailto");
		expect(tree.children[0]).toMatchObject({
			type: "paragraph",
			children: [{ type: "link", url: "", children: [{ type: "text", value: "click" }] }],
		});
	});

	it("drops a builtin's link prop with an unsupported scheme, but not an image source", () => {
		const tree = parseMdx(
			'<Card title="x" href="javascript:alert(1)">card</Card>\n\n<Card href={"JaVa\\tscript:1"} />\n\n<Card href="https://example.com" />\n\n<Screenshot src="javascript:1" />\n',
		);
		const diagnostics: RestrictDiagnostic[] = [];
		restrictTree(tree, {
			components: ["Card", "Screenshot"],
			onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		});
		expect(diagnostics).toMatchObject([
			{ code: "invalid-href", line: 1 },
			{ code: "invalid-href", line: 3 },
		]);
		expect(diagnostics[0].message).toContain("`href` prop on <Card> is dropped");
		const attributes = elements(tree).map((element) =>
			element.attributes.map((attribute) => (attribute as { name: string }).name),
		);
		expect(attributes).toEqual([["title"], [], ["href"], ["src"]]);
	});

	it("checks definitions and <a href>", () => {
		expect(codes("[x][ref]\n\n[ref]: data:text/html,hi\n")).toEqual(["invalid-href"]);
		const { tree, diagnostics } = restrict(
			'<a href="vbscript:run">x</a> and <a href={"javascript:1"}>y</a>\n',
		);
		expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
			"invalid-href",
			"invalid-href",
		]);
		for (const element of elements(tree)) {
			expect(element.attributes[0]).toMatchObject({ name: "href", value: "" });
		}
	});

	it("sees through whitespace and control characters inside the scheme", () => {
		expect(isAllowedHref("java\tscript:alert(1)")).toBe(false);
		expect(isAllowedHref(" JAVASCRIPT:alert(1)")).toBe(false);
		expect(isAllowedHref("HTTPS://example.com")).toBe(true);
	});
});

describe("proseText", () => {
	it("matches the rule for prose literals", () => {
		expect(proseText("a")).toBe("a");
		expect(proseText(1.5)).toBe("1.5");
		expect(proseText([1, "a"])).toBe('[1,"a"]');
		expect(proseText({ a: null })).toBe('{"a":null}');
		expect(proseText(true)).toBe("");
		expect(proseText(false)).toBe("");
		expect(proseText(null)).toBe("");
	});
});
