import type { Parent, Root, RootContent } from "mdast";
import type {
	MdxFlowExpression,
	MdxJsxAttribute,
	MdxJsxExpressionAttribute,
	MdxJsxFlowElement,
	MdxJsxTextElement,
	MdxTextExpression,
	MdxjsEsm,
} from "mdast-util-mdx";
import type { Program } from "estree";
import type { Position } from "unist";
import { suggestFrom } from "../components/registry.js";
import { foldProgram, type Json } from "./literal.js";

/** The codes `restrictTree` reports; `DOCUMENT_DIAGNOSTIC_CODES` builds on them. */
export const RESTRICT_DIAGNOSTIC_CODES = [
	"esm-not-supported",
	"non-literal-expression",
	"unknown-component",
	"removed-component",
	"unsupported-element",
	"unsupported-attribute",
	"invalid-href",
] as const;

type RestrictDiagnosticCode = (typeof RESTRICT_DIAGNOSTIC_CODES)[number];

/**
 * One rule the document broke. The tree has already been repaired when this is reported.
 * @internal Exported for its tests.
 */
export interface RestrictDiagnostic {
	code: RestrictDiagnosticCode;
	message: string;
	line?: number;
	column?: number;
	endLine?: number;
	endColumn?: number;
	component?: string;
	prop?: string;
	suggestions?: string[];
}

export interface RestrictOptions {
	/** Names of the builtin components a document may use (the component registry). */
	components: Iterable<string>;
	/** Called once for each rule the document broke, in document order. */
	onDiagnostic?: (diagnostic: RestrictDiagnostic) => void;
}

/**
 * Lowercase elements a document may write anywhere.
 * @internal Exported for its tests.
 */
export const SUPPORTED_ELEMENTS: readonly string[] = [
	"kbd",
	"abbr",
	"sub",
	"sup",
	"mark",
	"b",
	"i",
	"u",
	"s",
	"em",
	"strong",
	"small",
	"br",
	"span",
	"details",
	"summary",
	"table",
	"a",
	"img",
];

/**
 * Lowercase elements a document may write only inside a `table` element.
 * @internal Exported for its tests.
 */
export const TABLE_ELEMENTS: readonly string[] = ["thead", "tbody", "tr", "th", "td"];

/** Builtins that no longer exist. Each is unwrapped like an unknown component, with its own message. */
const REMOVED_COMPONENTS: readonly string[] = ["Button", "Dropdown", "Option"];

/**
 * Props of builtins that become a link's `href`, scheme-checked like `<a href>`.
 * Image sources are not links and are not checked.
 */
const BUILTIN_LINK_PROPS: Record<string, readonly string[]> = { Card: ["href"] };

/** Elements removed together with their content rather than unwrapped. */
const DROPPED_ELEMENTS = new Set(["script", "style"]);

const ELEMENT_ATTRIBUTES: Record<string, readonly string[]> = {
	abbr: ["title"],
	details: ["open", "id"],
	a: ["href", "title"],
	img: ["src", "alt", "title", "width", "height"],
	th: ["colspan", "rowspan", "align"],
	td: ["colspan", "rowspan", "align"],
};

const SUPPORTED_SET = new Set(SUPPORTED_ELEMENTS);
const TABLE_SET = new Set(TABLE_ELEMENTS);
const REMOVED_SET = new Set(REMOVED_COMPONENTS);

const ELEMENT_LIST = SUPPORTED_ELEMENTS.join(", ");
const LITERAL_HINT = "Write the value as a literal array, object, string or number.";

type JsxElement = MdxJsxFlowElement | MdxJsxTextElement;
type Expression = MdxFlowExpression | MdxTextExpression;

/**
 * Limit a document to builtin components, supported lowercase elements and
 * literal values. It repairs `tree` in place so what is left still renders,
 * and reports each repair through `options.onDiagnostic`:
 *
 * - `import`/`export` blocks are removed.
 * - A brace expression in prose becomes text when it is a literal (an array
 *   or object as its JSON text, a string or number as its text, `true`,
 *   `false` and `null` as nothing) and is removed when it is not.
 * - An attribute expression is kept when it folds to a literal (the document
 *   converter folds it again) and dropped when it does not.
 * - An unknown or removed component and an unsupported lowercase element are
 *   unwrapped: the tag goes, its children stay. `script` and `style` go with
 *   their children.
 * - An attribute outside the allowlist for its tag (always `className`,
 *   `style` and `on*`) is dropped.
 * - A link whose scheme is not http, https or mailto gets an empty href.
 */
export function restrictTree(tree: Root, options: RestrictOptions): void {
	const components = new Set(options.components);
	const componentNames = [...components];
	const report = (diagnostic: RestrictDiagnostic) => options.onDiagnostic?.(diagnostic);

	function restrictChildren(parent: Parent, insideTable: boolean): void {
		const next: RootContent[] = [];
		for (const child of parent.children as RootContent[]) {
			next.push(...restrictNode(child, insideTable));
		}
		parent.children = next as Parent["children"];
	}

	/** The nodes that take `node`'s place: itself, its children, a text node, or nothing. */
	function restrictNode(node: RootContent, insideTable: boolean): RootContent[] {
		switch (node.type) {
			case "mdxjsEsm":
				reportEsm(node);
				return [];
			case "mdxFlowExpression":
			case "mdxTextExpression":
				return restrictExpression(node);
			case "mdxJsxFlowElement":
			case "mdxJsxTextElement":
				return restrictElement(node, insideTable);
			case "link":
			case "definition":
				if (!isAllowedHref(node.url)) {
					reportHref(node.url, node.position);
					node.url = "";
				}
				break;
			default:
				break;
		}
		if ("children" in node) restrictChildren(node as Parent, insideTable);
		return [node];
	}

	function reportEsm(node: MdxjsEsm): void {
		const estree = node.data?.estree as Program | undefined;
		const statements = estree?.body ?? [];
		if (statements.length === 0) {
			report({ code: "esm-not-supported", message: esmMessage(node.value), ...at(node.position) });
			return;
		}
		for (const statement of statements) {
			const loc = statement.loc;
			const lines = node.value.split(/\r?\n/);
			const startLine = node.position?.start.line;
			const text =
				loc && startLine !== undefined
					? (lines[loc.start.line - startLine] ?? node.value)
					: node.value;
			report({
				code: "esm-not-supported",
				message: esmMessage(text),
				...(loc
					? {
							line: loc.start.line,
							column: loc.start.column + 1,
							endLine: loc.end.line,
							endColumn: loc.end.column + 1,
						}
					: at(node.position)),
			});
		}
	}

	function restrictExpression(node: Expression): RootContent[] {
		const folded = foldProgram(node.data?.estree);
		if (folded.kind === "empty") return [];
		if (folded.kind === "non-literal") {
			report({
				code: "non-literal-expression",
				message: `\`{${snippet(node.value)}}\` is not a literal value, so it is not shown. ${LITERAL_HINT}`,
				...at(node.position),
			});
			return [];
		}
		const text = proseText(folded.value);
		if (text === "") return [];
		const textNode: RootContent = { type: "text", value: text, position: node.position };
		if (node.type === "mdxTextExpression") return [textNode];
		return [{ type: "paragraph", children: [textNode], position: node.position }];
	}

	function restrictElement(node: JsxElement, insideTable: boolean): RootContent[] {
		const name = node.name;
		const childInsideTable = insideTable || name === "table";

		if (name === null) {
			report({
				code: "unsupported-element",
				message: `A fragment (\`<>…</>\`) is not supported, so only its content is shown. Remove the \`<>\` and \`</>\`.`,
				...at(node.position),
			});
			return unwrap(node, "<>", insideTable);
		}

		if (isLowercase(name)) {
			if (DROPPED_ELEMENTS.has(name)) {
				report({
					code: "unsupported-element",
					message: `<${name}> is not supported in documents, so it is removed together with its content. Delete it.`,
					...at(node.position),
				});
				return [];
			}
			const supported = SUPPORTED_SET.has(name) || (insideTable && TABLE_SET.has(name));
			if (!supported) {
				const where = TABLE_SET.has(name) ? " outside a <table>" : "";
				report({
					code: "unsupported-element",
					message: `<${name}> is not supported${where}, so only its content is shown. Use markdown or one of the supported elements: ${ELEMENT_LIST} (and ${TABLE_ELEMENTS.join(", ")} inside <table>).`,
					...at(node.position),
				});
				return unwrap(node, name, insideTable);
			}
			restrictAttributes(node, name, ELEMENT_ATTRIBUTES[name] ?? [], undefined);
			restrictChildren(node, childInsideTable);
			return [node];
		}

		if (REMOVED_SET.has(name)) {
			report({
				code: "removed-component",
				message: `<${name}> is no longer a builtin component, so only its content is shown. Remove it, or use \`Tabs\` to switch content.`,
				component: name,
				...at(node.position),
			});
			return unwrap(node, name, insideTable);
		}

		if (!components.has(name)) {
			const suggestions = suggestFrom(componentNames, name.split(".")[0]);
			const didYouMean = suggestions.length > 0 ? ` Did you mean ${suggestions[0]}?` : "";
			report({
				code: "unknown-component",
				message: `Unknown component <${name}>, so only its content is shown.${didYouMean} Documents can use only builtin components; run \`mdxserve components\` for the list.`,
				component: name,
				suggestions,
				...at(node.position),
			});
			return unwrap(node, name, insideTable);
		}

		restrictAttributes(node, name, undefined, name);
		restrictChildren(node, insideTable);
		return [node];
	}

	/**
	 * The children that take an unwrapped tag's place. Its attributes go with
	 * the tag, but each one no tag allows (`className`, `style`, `on*`, a
	 * spread, a non-literal value) is still reported, as on a builtin.
	 */
	function unwrap(node: JsxElement, tag: string, insideTable: boolean): RootContent[] {
		const component = tag === "<>" || isLowercase(tag) ? undefined : tag;
		restrictAttributes(node, tag, undefined, component);
		restrictChildren(node, insideTable);
		return node.children as RootContent[];
	}

	/**
	 * Drop attributes the tag does not allow and fold the rest. `allowed` is the
	 * allowlist of a lowercase element; a builtin (`allowed` undefined) keeps
	 * every prop except `className`, `style` and `on*`, which no tag allows.
	 * `component` is the component each diagnostic names: none for a lowercase
	 * element or a fragment.
	 */
	function restrictAttributes(
		node: JsxElement,
		tag: string,
		allowed: readonly string[] | undefined,
		component: string | undefined,
	): void {
		const kept: (MdxJsxAttribute | MdxJsxExpressionAttribute)[] = [];
		for (const attribute of node.attributes) {
			if (attribute.type === "mdxJsxExpressionAttribute") {
				report({
					code: "non-literal-expression",
					message: `The spread attribute \`${snippet(attribute.value)}\` on <${tag}> is not supported, so it is dropped. Write each prop as name={literal}. ${LITERAL_HINT}`,
					...at(attribute.position ?? node.position),
				});
				continue;
			}
			const attributeName = attribute.name;
			const forbidden =
				attributeName === "className" ||
				attributeName === "class" ||
				attributeName === "style" ||
				/^on/i.test(attributeName);
			if (forbidden || (allowed !== undefined && !allowed.includes(attributeName))) {
				report({
					code: "unsupported-attribute",
					message: unsupportedAttributeMessage(tag, attributeName, allowed),
					component,
					prop: attributeName,
					...at(attribute.position ?? node.position),
				});
				continue;
			}

			const value = attribute.value;
			if (value !== null && value !== undefined && typeof value === "object") {
				const folded = foldProgram(value.data?.estree);
				if (folded.kind !== "literal") {
					report({
						code: "non-literal-expression",
						message: `The value of \`${attributeName}\` on <${tag}>, \`{${snippet(value.value)}}\`, is not a literal, so the attribute is dropped. ${LITERAL_HINT}`,
						component,
						prop: attributeName,
						...at(attribute.position ?? node.position),
					});
					continue;
				}
				if (tag === "a" && attributeName === "href" && !isAllowedHrefValue(folded.value)) {
					reportHref(String(folded.value), attribute.position ?? node.position);
					attribute.value = "";
				}
			} else if (tag === "a" && attributeName === "href" && typeof value === "string") {
				if (!isAllowedHref(value)) {
					reportHref(value, attribute.position ?? node.position);
					attribute.value = "";
				}
			}
			if (allowed === undefined && BUILTIN_LINK_PROPS[tag]?.includes(attributeName)) {
				const target = linkTarget(attribute.value);
				if (target !== undefined && !isAllowedHref(target)) {
					// A builtin's link prop is dropped, not emptied: the component then
					// renders as it does with no link at all.
					reportHref(
						target,
						attribute.position ?? node.position,
						`the \`${attributeName}\` prop on <${tag}> is dropped`,
					);
					continue;
				}
			}
			kept.push(attribute);
		}
		node.attributes = kept;
	}

	function reportHref(
		href: string,
		position: Position | undefined,
		outcome = "the link has no target",
	): void {
		report({
			code: "invalid-href",
			message: `The link target \`${snippet(href)}\` uses an unsupported scheme, so ${outcome}. Use http, https, mailto, a relative path or an anchor.`,
			...at(position),
		});
	}

	restrictChildren(tree, false);
}

function unsupportedAttributeMessage(
	tag: string,
	name: string,
	allowed: readonly string[] | undefined,
): string {
	let reason: string;
	if (name === "className" || name === "class" || name === "style") {
		reason = "Documents cannot set CSS classes or styles.";
	} else if (/^on/i.test(name)) {
		reason = "Documents cannot attach event handlers.";
	} else if (allowed && allowed.length > 0) {
		reason = `<${tag}> accepts only ${allowed.map((item) => `\`${item}\``).join(", ")}.`;
	} else {
		reason = `<${tag}> accepts no attributes.`;
	}
	return `The \`${name}\` attribute is not supported on <${tag}>, so it is dropped. ${reason} Remove the attribute.`;
}

function esmMessage(text: string): string {
	const keyword = /^\s*export\b/.test(text) ? "export" : "import";
	return `\`${snippet(text)}\`: ${keyword} statements are not supported in documents, so it is ignored. Delete the line and use a builtin component (run \`mdxserve components\`), or write the value inline as a literal.`;
}

/**
 * The text a literal shows in prose: JSON for arrays and objects, the value itself for strings and numbers, nothing for booleans and null.
 * @internal Exported for its tests.
 */
export function proseText(value: Json): string {
	if (value === null || typeof value === "boolean") return "";
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	return JSON.stringify(value);
}

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const ALLOWED_SCHEMES = new Set(["http", "https", "mailto"]);

/**
 * True for http, https and mailto URLs, relative paths and in-page anchors.
 * @internal Exported for its tests.
 */
export function isAllowedHref(href: string): boolean {
	// Browsers drop ASCII whitespace and control characters inside a URL's
	// scheme (`java\tscript:`), so test what the browser would see.
	// eslint-disable-next-line no-control-regex
	const normalized = href.replace(/[\u0000- \u007f]/g, "");
	const match = normalized.match(SCHEME);
	return match === null || ALLOWED_SCHEMES.has(match[1].toLowerCase());
}

/** The string an attribute holds, written plainly or as a folded literal; undefined otherwise. */
function linkTarget(value: MdxJsxAttribute["value"]): string | undefined {
	if (typeof value === "string") return value;
	if (value === null || value === undefined) return undefined;
	const folded = foldProgram(value.data?.estree);
	return folded.kind === "literal" && typeof folded.value === "string" ? folded.value : undefined;
}

function isAllowedHrefValue(value: Json): boolean {
	return typeof value === "string" ? isAllowedHref(value) : true;
}

function isLowercase(name: string): boolean {
	const first = name[0];
	return first !== undefined && first === first.toLowerCase() && first !== first.toUpperCase();
}

function snippet(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

function at(
	position: Position | undefined,
): Pick<RestrictDiagnostic, "line" | "column" | "endLine" | "endColumn"> {
	return {
		line: position?.start.line,
		column: position?.start.column,
		endLine: position?.end.line,
		endColumn: position?.end.column,
	};
}
