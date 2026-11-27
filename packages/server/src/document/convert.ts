import type {
	Code,
	Definition,
	Heading,
	List,
	PhrasingContent,
	Root,
	RootContent,
	Table,
} from "mdast";
import type { MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx";
import type { Position } from "unist";
import type { z } from "zod";
import { toString as mdastToString } from "mdast-util-to-string";
import { describePropType, suggestFrom, type Registry } from "../components/registry.js";
import { STATEFUL_COMPONENTS } from "@mdxserve/shared/builtins";
import { tabValueFromLabel } from "@mdxserve/shared/builtins/tabs";
import { foldProgram, type Json } from "./literal.js";
import { placeOf, type DocumentDiagnostic } from "./diagnostics.js";
import { IdAllocator, PREAMBLE_ID, headingSlug, isValidAuthoredId, joinPath } from "./ids.js";
import {
	buildSections,
	endLineOf,
	startLineOf,
	type FailedChunk,
	type FlowNode,
	type SectionItem,
} from "./sections.js";
import type { TableIdentity } from "./table-ids.js";
import type { BlockNode, ComponentNode, ElementNode, InlineNode, TabNode } from "./schema.js";

/** Inclusive, 1-based line range of a node a reader can edit. */
export interface LineRange {
	startLine: number;
	endLine: number;
}

export interface ConvertOptions {
	registry: Registry;
	/** Each builtin's zod prop schema, by name. */
	propSchemas: Readonly<Record<string, z.ZodObject>>;
	/** Rewrites a document-relative image path to the URL a client loads it from. */
	assetUrl: (relativePath: string) => string;
	/** Lines in the file, as `spliceLines` counts them. Ranges are clamped to it. */
	lineCount: number;
	tables: Map<Table, TableIdentity>;
	report: (diagnostic: DocumentDiagnostic) => void;
}

export interface ConvertResult {
	children: BlockNode[];
	ranges: Map<string, LineRange>;
}

/** Where a node sits: what owns its positional ID, and the heading path above it. */
interface Scope {
	owner: string;
	path: string[];
}

type JsxElement = MdxJsxFlowElement | MdxJsxTextElement;

type FoldedAttributes = Map<string, { value: Json; position: Position | undefined }>;

const STATEFUL = new Set(STATEFUL_COMPONENTS);

const PHRASING_TYPES = new Set([
	"text",
	"emphasis",
	"strong",
	"delete",
	"inlineCode",
	"break",
	"link",
	"linkReference",
	"image",
	"imageReference",
	"footnoteReference",
	"mdxJsxTextElement",
	"html",
]);

/**
 * Turn a restricted mdast into the nodes of the document tree, giving each
 * node its ID and recording the line range of each node a reader can edit.
 * Every ID rule the tree promises is applied here; each fallback reports the
 * diagnostic that goes with it and keeps the document rendering.
 */
export function convertDocument(root: Root, options: ConvertOptions): ConvertResult {
	const { registry, propSchemas, report, lineCount } = options;
	const ids = new IdAllocator();
	const ranges = new Map<string, LineRange>();
	const definitions = collectDefinitions(root);
	const registryProps = new Map(
		registry.components.map((component) => [
			component.name,
			(component.props?.properties as Record<string, Record<string, unknown>> | undefined) ?? {},
		]),
	);

	// Which heading slugs repeat anywhere in the document decides whether a
	// heading's ID is its slug or its full path.
	const slugCounts = new Map<string, number>();
	const slugText = new Map<string, string>();
	for (const text of headingTexts(root)) {
		const slug = headingSlug(text);
		if (!slug) continue;
		slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
		if (!slugText.has(slug)) slugText.set(slug, text);
	}
	/**
	 * Every heading slug. An authored `id` may not equal one: a unique heading
	 * takes its slug as its ID, and `#slug` falls back to the first heading of a
	 * repeated one, so the id would break when the headings change.
	 */
	const headingIds = new Set(slugCounts.keys());

	const pathLines = new Map<string, { line: number | undefined; count: number }>();
	const authoredLines = new Map<string, number | undefined>();
	const tableIds = new Set([...options.tables.values()].map((identity) => identity.id));
	let emptySlugCount = 0;
	let failedCount = 0;
	/** How many inline `<Tabs>` the conversion is inside. */
	let inlineTabsDepth = 0;

	function setRange(id: string, startLine: number | undefined, endLine: number | undefined) {
		if (startLine === undefined || endLine === undefined || lineCount === 0) return;
		const start = Math.min(Math.max(startLine, 1), lineCount);
		const end = Math.min(Math.max(endLine, start), lineCount);
		ranges.set(id, { startLine: start, endLine: end });
	}

	function nodeRange(id: string, node: FlowNode) {
		setRange(id, startLineOf(node), endLineOf(node));
	}

	// ---- containers and sections -------------------------------------------

	function convertRoot(): BlockNode[] {
		const nodes = root.children as FlowNode[];
		const frontmatter = nodes.find((node) => node.type === "yaml");
		const afterFrontmatter = frontmatter ? (endLineOf(frontmatter) ?? 0) + 1 : 1;
		const items = buildSections(
			nodes.filter((node) => node.type !== "yaml"),
			lineCount,
		);

		const leading: FlowNode[] = [];
		let index = 0;
		while (
			index < items.length &&
			items[index].kind === "node" &&
			(items[index] as { node: FlowNode }).node.type !== "mdxserveFailedChunk"
		) {
			leading.push((items[index] as { node: FlowNode }).node);
			index++;
		}

		const result: BlockNode[] = [];
		if (leading.some((node) => node.type !== "definition")) {
			const id = ids.claim(PREAMBLE_ID);
			const next = items[index];
			const nextStart =
				next === undefined
					? undefined
					: next.kind === "section"
						? next.startLine
						: startLineOf(next.node);
			setRange(id, afterFrontmatter, nextStart === undefined ? lineCount : nextStart - 1);
			result.push({
				type: "preamble",
				id,
				children: convertFlow(leading, { owner: id, path: [] }),
			});
		}
		result.push(...convertItems(items.slice(index), { owner: PREAMBLE_ID, path: [] }));
		return result;
	}

	/** Convert the children of a block container, grouping them into sections. */
	function convertContainer(nodes: FlowNode[], scope: Scope): BlockNode[] {
		const last = nodes.length > 0 ? endLineOf(nodes[nodes.length - 1]) : undefined;
		return convertItems(buildSections(nodes, last ?? lineCount), scope);
	}

	function convertItems(items: SectionItem[], scope: Scope): BlockNode[] {
		const result: BlockNode[] = [];
		const run: FlowNode[] = [];
		const flush = () => {
			if (run.length > 0) result.push(...convertFlow(run.splice(0), scope));
		};
		for (const item of items) {
			if (item.kind === "node") {
				run.push(item.node);
				continue;
			}
			flush();
			result.push(convertSection(item, scope));
		}
		flush();
		return result;
	}

	function convertSection(
		item: Extract<SectionItem, { kind: "section" }>,
		scope: Scope,
	): BlockNode {
		const heading = item.heading;
		const text = headingText(heading);
		let slug = headingSlug(text);
		let unique = slugCounts.get(slug) === 1;
		if (!slug) {
			emptySlugCount += 1;
			slug = `~section-${emptySlugCount}`;
			unique = true;
		}
		const fullPath = [...scope.path, slug];
		let id: string;
		let childPath = fullPath;
		if (unique) {
			id = slug;
		} else {
			const key = joinPath(fullPath);
			const line = heading.position?.start.line;
			const seen = pathLines.get(key);
			if (seen) {
				seen.count += 1;
				id = `${key}>~${seen.count}`;
				childPath = [...fullPath, `~${seen.count}`];
				report({
					severity: "error",
					code: "duplicate-heading",
					message: `The heading "${text}" repeats under the same parent heading${seen.line === undefined ? "" : ` (first on line ${seen.line})`}, so its anchor becomes "${id}" and changes whenever the other one moves. Rename one heading.`,
					...placeOf(heading.position),
				});
			} else {
				pathLines.set(key, { line, count: 1 });
				id = key;
			}
		}
		id = ids.claim(id);
		setRange(id, item.startLine, item.endLine);
		const inner: Scope = { owner: id, path: childPath };
		return {
			type: "section",
			id,
			level: item.level,
			heading: convertInlines(heading.children, inner),
			children: convertItems(item.children, inner),
		};
	}

	/** Convert a run of nodes that are not headings; inline nodes in a row become one paragraph. */
	function convertFlow(nodes: FlowNode[], scope: Scope): BlockNode[] {
		const result: BlockNode[] = [];
		let inline: PhrasingContent[] = [];
		const flush = () => {
			if (inline.length === 0) return;
			result.push({ type: "paragraph", children: convertInlines(inline, scope) });
			inline = [];
		};
		for (const node of nodes) {
			if (PHRASING_TYPES.has(node.type)) {
				inline.push(node as PhrasingContent);
				continue;
			}
			flush();
			result.push(...convertBlock(node, scope));
		}
		flush();
		return result;
	}

	// ---- block nodes --------------------------------------------------------

	function convertBlock(node: FlowNode, scope: Scope): BlockNode[] {
		switch (node.type) {
			case "mdxserveFailedChunk":
				return [convertFailedChunk(node)];
			case "paragraph":
				return [{ type: "paragraph", children: convertInlines(node.children, scope) }];
			case "heading":
				// Only reached when a heading has no container to open a section in.
				return [{ type: "paragraph", children: convertInlines(node.children, scope) }];
			case "blockquote":
				return [
					{ type: "blockquote", children: convertContainer(node.children as FlowNode[], scope) },
				];
			case "list":
				return [convertList(node, scope)];
			case "code":
				return [convertCode(node, scope)];
			case "table":
				return [convertTable(node, scope)];
			case "thematicBreak":
				return [{ type: "thematicBreak" }];
			case "footnoteDefinition":
				return [
					{
						type: "footnoteDefinition",
						label: node.identifier,
						children: convertContainer(node.children as FlowNode[], scope),
					},
				];
			case "mdxJsxFlowElement":
				if (node.name === "Tabs") return convertTabs(node, scope);
				return [convertJsx(node, scope, "flow") as BlockNode];
			default:
				// yaml, definitions (resolved into their references), and anything
				// the restricted language leaves no room for.
				return [];
		}
	}

	function convertFailedChunk(node: FailedChunk): BlockNode {
		failedCount += 1;
		const slug = node.headingText === null ? "" : headingSlug(node.headingText);
		const id = ids.claim(slug || `~error-${failedCount}`);
		setRange(id, node.startLine, node.endLine);
		return { type: "error", id, message: node.message, source: node.source };
	}

	function convertList(node: List, scope: Scope): BlockNode {
		return {
			type: "list",
			ordered: node.ordered === true,
			start: node.ordered === true ? (node.start ?? 1) : null,
			items: node.children.map((item) => ({
				checked: typeof item.checked === "boolean" ? item.checked : null,
				children: convertContainer(item.children as FlowNode[], scope),
			})),
		};
	}

	function convertCode(node: Code, scope: Scope): BlockNode {
		const lang = node.lang ?? null;
		let id: string | null = null;
		if (lang === "mermaid") {
			id = ids.positional(scope.owner, "mermaid");
			nodeRange(id, node);
		}
		const meta = parseFenceMeta(node.meta ?? null, lineCountOf(node.value));
		return { type: "code", id, lang, ...meta, value: node.value };
	}

	function convertTable(node: Table, scope: Scope): BlockNode {
		const identity = options.tables.get(node) ?? {
			id: "markdown-table-v2-unknown",
			persist: false,
		};
		const [head, ...rows] = node.children;
		return {
			type: "table",
			id: identity.id,
			persist: identity.persist,
			align: (node.align ?? []).map((align) => align ?? null),
			head: (head?.children ?? []).map((cell) => convertInlines(cell.children, scope)),
			rows: rows.map((row) => row.children.map((cell) => convertInlines(cell.children, scope))),
		};
	}

	// ---- JSX ----------------------------------------------------------------

	function convertJsx(
		node: JsxElement,
		scope: Scope,
		position: "flow" | "text",
	): ComponentNode | ElementNode | BlockNode {
		const name = node.name ?? "";
		if (isLowercase(name)) return convertElement(node, name, scope, position);
		if (name !== "Tabs") return convertComponent(node, name, scope, position);
		// A flow `<Tabs>` is converted by `convertTabs`; this one sits in a paragraph.
		report({
			severity: "error",
			code: "invalid-tabs-structure",
			message:
				"<Tabs> is written inside a line of text, so it shows no tabs, only the content of each <Tab> in a row. Start <Tabs> on a line of its own, after a blank line, with each <Tab> on its own line.",
			component: "Tabs",
			...placeOf(node.position),
		});
		inlineTabsDepth += 1;
		try {
			return convertComponent(node, name, scope, position);
		} finally {
			inlineTabsDepth -= 1;
		}
	}

	function jsxChildren(
		node: JsxElement,
		scope: Scope,
		position: "flow" | "text",
	): (BlockNode | InlineNode)[] {
		// A one-line `<Callout>text</Callout>` is inline JSX lifted to flow: its
		// children stay inline, as MDX renders them, not wrapped in a paragraph.
		const inline =
			position === "text" ||
			(node.children.length > 0 && node.children.every((child) => PHRASING_TYPES.has(child.type)));
		return inline
			? convertInlines(node.children as PhrasingContent[], scope)
			: convertContainer(node.children as FlowNode[], scope);
	}

	function convertComponent(
		node: JsxElement,
		name: string,
		scope: Scope,
		position: "flow" | "text",
	): ComponentNode {
		// A `<Tab>` directly inside a flow `<Tabs>` is converted by `convertTabs`.
		// One inside an inline `<Tabs>` is covered by that `<Tabs>`'s diagnostic.
		if (name === "Tab" && inlineTabsDepth === 0) {
			report({
				severity: "error",
				code: "invalid-tabs-structure",
				message:
					"<Tab> is not directly inside a <Tabs>, so it is not a tab: its content is shown in place, without its label. Move it directly inside a <Tabs>, or remove the <Tab> and </Tab> tags.",
				component: "Tab",
				...placeOf(node.position),
			});
		}
		const attributes = foldAttributes(node);
		const kind = name.toLowerCase();
		let id: string | null = null;
		if (STATEFUL.has(name)) {
			id = statefulId(node, `<${name}>`, kind, attributes, scope);
			attributes.delete("id");
		} else if (position === "flow") {
			id = ids.positional(scope.owner, kind);
		}
		if (id !== null && position === "flow") nodeRange(id, node as FlowNode);
		const props = checkProps(name, attributes, node.position);
		// Screenshot's `src` resolves like a Markdown image.
		if (name === "Screenshot" && typeof props.src === "string") props.src = resolveAsset(props.src);
		return { type: "component", id, name, props, children: jsxChildren(node, scope, position) };
	}

	/**
	 * A flow `<Tabs>`, and before it whatever sits directly inside it that is
	 * not a `<Tab>`: that content is shown, in document order, ahead of the tabs.
	 */
	function convertTabs(node: MdxJsxFlowElement, scope: Scope): BlockNode[] {
		const attributes = foldAttributes(node);
		const id = statefulId(node, "<Tabs>", "tabs", attributes, scope);
		attributes.delete("id");
		nodeRange(id, node);
		const props = checkProps("Tabs", attributes, node.position);

		const stray: BlockNode[] = [];
		const strayRun: RootContent[] = [];
		const flushStray = () => {
			if (strayRun.length === 0) return;
			const first = strayRun[0].position;
			const last = strayRun[strayRun.length - 1].position;
			report({
				severity: "error",
				code: "invalid-tabs-structure",
				message: `Content directly inside <Tabs id="${id}"> is not in a <Tab>, so it is shown before the tabs instead of in one. Move it into a <Tab label="…">, or out of <Tabs>.`,
				component: "Tabs",
				...placeOf(first && last ? { start: first.start, end: last.end } : node.position),
			});
			stray.push(...convertContainer(strayRun.splice(0), scope));
		};

		const tabs: TabNode[] = [];
		const values = new Set<string>();
		for (const child of node.children as RootContent[]) {
			const isTab =
				(child.type === "mdxJsxFlowElement" || child.type === "mdxJsxTextElement") &&
				child.name === "Tab";
			if (!isTab) {
				// The space between tabs written on one line is not content.
				if (child.type !== "text" || child.value.trim() !== "") strayRun.push(child);
				continue;
			}
			flushStray();
			const tab = child as JsxElement;
			const tabProps = checkProps("Tab", foldAttributes(tab), tab.position, {
				label: `the tab is labelled "Tab ${tabs.length + 1}"`,
			});
			const labelled = typeof tabProps.label === "string";
			const label = labelled ? (tabProps.label as string) : `Tab ${tabs.length + 1}`;
			// A tab with no label of its own gets a generated value, unless it has one.
			let value = labelled ? tabValueFromLabel(label) : "";
			if (typeof tabProps.value === "string") {
				if (isValidAuthoredId(tabProps.value)) {
					value = tabProps.value;
				} else {
					report({
						severity: "error",
						code: "invalid-id",
						message: `The value ${JSON.stringify(tabProps.value)} on the tab "${label}" is not valid, so the tab uses "${value || "a generated value"}" and links to it can break. Use letters, digits, - and _, starting with a letter.`,
						component: "Tab",
						prop: "value",
						...placeOf(child.position),
					});
				}
			}
			if (value === "" || values.has(value)) {
				if (value !== "") {
					report({
						severity: "error",
						code: "duplicate-tab-value",
						message: `The tab "${label}" has the value "${value}", which an earlier tab in the same <Tabs> already uses, so it gets a generated value and links to it can break. Set a distinct \`value\` on one of them.`,
						component: "Tab",
						prop: "value",
						...placeOf(child.position),
					});
				}
				value = `~${tabs.length + 1}`;
			}
			values.add(value);
			const tabId = ids.claim(`${id}>${value}`);
			nodeRange(tabId, child);
			tabs.push({
				id: tabId,
				value,
				label,
				children: convertContainer(tab.children as FlowNode[], { owner: tabId, path: [tabId] }),
			});
		}
		flushStray();

		let defaultValue = tabs[0]?.value ?? "";
		const authored = props.defaultValue;
		if (authored !== undefined) {
			if (typeof authored === "string" && tabs.some((tab) => tab.value === authored)) {
				defaultValue = authored;
			} else {
				const listed = tabs.map((tab) => `"${tab.value}"`).join(", ");
				report({
					severity: "error",
					code: "invalid-tab-default",
					message: `defaultValue ${JSON.stringify(authored)} on <Tabs> matches no tab, so the first tab is selected. Use one of the tab values: ${listed || "(no tabs)"}.`,
					component: "Tabs",
					prop: "defaultValue",
					...placeOf(attributes.get("defaultValue")?.position ?? node.position),
				});
			}
		}
		return [...stray, { type: "tabs", id, defaultValue, tabs }];
	}

	function convertElement(
		node: JsxElement,
		tag: string,
		scope: Scope,
		position: "flow" | "text",
	): ElementNode {
		const attributes = foldAttributes(node);
		let id: string | null = null;
		if (tag === "details") {
			id = statefulId(node, "<details>", "details", attributes, scope);
			attributes.delete("id");
			if (position === "flow") nodeRange(id, node as FlowNode);
		}
		const attrs: Record<string, string | boolean> = {};
		for (const [name, { value, position: place }] of attributes) {
			if (typeof value === "string" || typeof value === "boolean") attrs[name] = value;
			else if (typeof value === "number") attrs[name] = String(value);
			else {
				report({
					severity: "error",
					code: "invalid-prop",
					message: `The \`${name}\` attribute on <${tag}> must be a string, number or boolean, so it is dropped. Write it as ${name}="…".`,
					prop: name,
					...placeOf(place ?? node.position),
				});
			}
		}
		if (tag === "img" && typeof attrs.src === "string") attrs.src = resolveAsset(attrs.src);
		return { type: "element", id, tag, attrs, children: jsxChildren(node, scope, position) };
	}

	/** The ID of a stateful component or `details`: its authored `id`, or a positional one with a diagnostic. */
	function statefulId(
		node: JsxElement,
		label: string,
		kind: string,
		attributes: FoldedAttributes,
		scope: Scope,
	): string {
		const authored = attributes.get("id");
		const place = placeOf(authored?.position ?? node.position);
		const component = label === "<details>" ? undefined : label.slice(1, -1);
		const fallback = (code: DocumentDiagnostic["code"], message: string): string => {
			report({ severity: "error", code, message, component, prop: "id", ...place });
			return ids.positional(scope.owner, kind);
		};
		if (authored === undefined) {
			return fallback(
				"missing-id",
				`${label} has no \`id\`, so the reader's state for it (such as the selected tab or the sort order) is not kept when the document changes. Add id="…", unique in the document, for example id="setup-${kind}".`,
			);
		}
		const value = authored.value;
		if (typeof value !== "string" || !isValidAuthoredId(value)) {
			return fallback(
				"invalid-id",
				`The id ${JSON.stringify(value)} on ${label} is not valid, so a generated id is used. Use letters, digits, - and _, starting with a letter.`,
			);
		}
		if (headingIds.has(value)) {
			return fallback(
				"id-conflicts-with-heading",
				`The id "${value}" on ${label} is the anchor of the heading "${slugText.get(value) ?? value}", so a generated id is used. Rename the id.`,
			);
		}
		if (tableIds.has(value)) {
			return fallback(
				"duplicate-id",
				`The id "${value}" on ${label} is already the id of a Markdown table, so this one gets a generated id. Rename the id.`,
			);
		}
		if (authoredLines.has(value)) {
			const first = authoredLines.get(value);
			const here = node.position?.start.line;
			return fallback(
				"duplicate-id",
				`The id "${value}" on ${label}${here === undefined ? "" : ` (line ${here})`} is already used${first === undefined ? "" : ` on line ${first}`}, so this one gets a generated id. Rename one of them.`,
			);
		}
		authoredLines.set(value, node.position?.start.line);
		return ids.claim(value);
	}

	/**
	 * The props of builtin `name` that its schema accepts, and no other key. A
	 * prop the schema (or the registry) does not declare, `key` and `ref`
	 * included, is an `unknown-prop` warning; a value the zod schema rejects is
	 * an `invalid-prop` error; both are dropped. A declared `children` is kept
	 * without a check. `outcomes` says, by prop, what the reader sees instead
	 * of a missing or invalid value, when it is more than the prop being dropped.
	 */
	function checkProps(
		name: string,
		attributes: FoldedAttributes,
		position: Position | undefined,
		outcomes: Readonly<Record<string, string>> = {},
	): Record<string, Json> {
		const known = registryProps.get(name);
		const knownNames = known ? Object.keys(known) : [];
		const shape = propSchemas[name]?.shape as Record<string, z.ZodType> | undefined;
		const declared = (prop: string): boolean => {
			if (shape && !Object.hasOwn(shape, prop)) return false;
			// The registry's JSON schema leaves `children` out; the zod shape has it.
			if (known && prop !== "children" && !Object.hasOwn(known, prop)) return false;
			return shape !== undefined || known !== undefined;
		};
		const kept: Record<string, Json> = {};
		for (const [prop, { value, position: place }] of attributes) {
			if (!declared(prop)) {
				const suggestions = suggestFrom(knownNames, prop);
				report({
					severity: "warning",
					code: "unknown-prop",
					message: `Unknown prop "${prop}" on <${name}>.${suggestions.length > 0 ? ` Did you mean ${suggestions[0]}?` : ""}`,
					component: name,
					prop,
					suggestions,
					...placeOf(place ?? position),
				});
				continue;
			}
			if (prop === "children") {
				kept[prop] = value;
				continue;
			}
			const field = shape?.[prop];
			if (field) {
				const parsed = field.safeParse(value);
				if (!parsed.success) {
					report({
						severity: "error",
						code: "invalid-prop",
						message: `The \`${prop}\` prop on <${name}> is not valid (${issueText(parsed.error)}), so ${Object.hasOwn(outcomes, prop) ? outcomes[prop] : "it is dropped"}. Use ${expectedType(known?.[prop])}.`,
						component: name,
						prop,
						...placeOf(place ?? position),
					});
					continue;
				}
			}
			kept[prop] = value;
		}
		if (shape) {
			for (const [prop, field] of Object.entries(shape)) {
				if (prop === "children" || prop === "id" || attributes.has(prop)) continue;
				if (field.safeParse(undefined).success) continue;
				report({
					severity: "error",
					code: "invalid-prop",
					message: `<${name}> needs a \`${prop}\` prop, and has none${Object.hasOwn(outcomes, prop) ? `, so ${outcomes[prop]}` : ""}. Add ${prop}={…} with ${expectedType(known?.[prop])}.`,
					component: name,
					prop,
					...placeOf(position),
				});
			}
		}
		return kept;
	}

	// ---- inline nodes -------------------------------------------------------

	function convertInlines(nodes: readonly PhrasingContent[], scope: Scope): InlineNode[] {
		const result: InlineNode[] = [];
		for (const node of nodes) result.push(...convertInline(node, scope));
		return result;
	}

	function convertInline(node: PhrasingContent, scope: Scope): InlineNode[] {
		switch (node.type) {
			case "text":
				return [{ type: "text", value: node.value }];
			case "emphasis":
			case "strong":
			case "delete":
				return [{ type: node.type, children: convertInlines(node.children, scope) }];
			case "inlineCode":
				return [{ type: "inlineCode", value: node.value }];
			case "break":
				return [{ type: "break" }];
			case "link":
				return [
					{
						type: "link",
						href: node.url,
						title: node.title ?? null,
						children: convertInlines(node.children, scope),
					},
				];
			case "linkReference": {
				const definition = definitions.get(node.identifier);
				const children = convertInlines(node.children, scope);
				if (!definition) return children;
				return [{ type: "link", href: definition.url, title: definition.title ?? null, children }];
			}
			case "image":
				return [
					{
						type: "image",
						src: resolveAsset(node.url),
						alt: node.alt ?? "",
						title: node.title ?? null,
					},
				];
			case "imageReference": {
				const definition = definitions.get(node.identifier);
				if (!definition) return node.alt ? [{ type: "text", value: node.alt }] : [];
				return [
					{
						type: "image",
						src: resolveAsset(definition.url),
						alt: node.alt ?? "",
						title: definition.title ?? null,
					},
				];
			}
			case "footnoteReference":
				return [{ type: "footnoteReference", label: node.identifier }];
			case "mdxJsxTextElement":
				return [convertJsx(node, scope, "text") as InlineNode];
			case "html":
				return [{ type: "text", value: node.value }];
			default:
				return [];
		}
	}

	// A path relative to the document, or an absolute path on this machine (a
	// root-absolute URL is a file path here), loads through the asset endpoint.
	function resolveAsset(url: string): string {
		return isDocumentRelative(url) || isLocalAbsolute(url) ? options.assetUrl(url) : url;
	}

	// A table's id is a hash its persisted preferences are kept under, so it
	// cannot move: reserve every one before any other node takes an id.
	for (const { id } of options.tables.values()) ids.claim(id);
	return { children: convertRoot(), ranges };
}

/** Heading text the way `rehype-slug` reads it: no image alt text. */
function headingText(heading: Heading): string {
	return mdastToString(heading, { includeImageAlt: false });
}

function headingTexts(root: Root): string[] {
	const texts: string[] = [];
	const visit = (node: Root | RootContent | FailedChunk) => {
		if (node.type === "heading") texts.push(headingText(node));
		if (node.type === "mdxserveFailedChunk") {
			if (node.headingText !== null) texts.push(node.headingText);
			return;
		}
		if ("children" in node) for (const child of node.children) visit(child as RootContent);
	};
	visit(root);
	return texts;
}

function collectDefinitions(root: Root): Map<string, Definition> {
	const definitions = new Map<string, Definition>();
	const visit = (node: Root | RootContent) => {
		if (node.type === "definition" && !definitions.has(node.identifier))
			definitions.set(node.identifier, node);
		if ("children" in node) for (const child of node.children) visit(child as RootContent);
	};
	visit(root);
	return definitions;
}

function foldAttributes(node: JsxElement): FoldedAttributes {
	const folded: FoldedAttributes = new Map();
	for (const attribute of node.attributes) {
		if (attribute.type !== "mdxJsxAttribute") continue;
		const raw = attribute.value;
		let value: Json;
		if (raw === null || raw === undefined) value = true;
		else if (typeof raw === "string") value = raw;
		else {
			const result = foldProgram(raw.data?.estree);
			if (result.kind !== "literal") continue;
			value = result.value;
		}
		folded.set(attribute.name, { value, position: attribute.position });
	}
	return folded;
}

function issueText(error: z.ZodError): string {
	const issue = error.issues[0];
	if (!issue) return "invalid value";
	const where = issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
	return `${issue.message}${where}`;
}

function expectedType(schema: Record<string, unknown> | undefined): string {
	return schema ? `a value of type ${describePropType(schema)}` : "the type the component declares";
}

function isLowercase(name: string): boolean {
	const first = name[0];
	return first !== undefined && first === first.toLowerCase() && first !== first.toUpperCase();
}

/** A URL with no scheme that is not absolute, protocol-relative or an in-page anchor. */
function isDocumentRelative(url: string): boolean {
	if (url === "" || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) return false;
	return (
		!url.startsWith("/") && !url.startsWith("#") && !url.startsWith("?") && !url.startsWith("\\")
	);
}

/** An absolute path such as `/docs/img.png`, but not a protocol-relative `//host/...` URL. */
function isLocalAbsolute(url: string): boolean {
	return url.startsWith("/") && !url.startsWith("//");
}

function lineCountOf(value: string): number {
	return value === "" ? 1 : value.split(/\r\n|\r|\n/).length;
}

/** The highlighted lines of a code block are capped to this many, whatever its meta says. */
const MAX_HIGHLIGHT_LINES = 10_000;

/**
 * Read the fence meta of a code block: `title="…"`, `showLineNumbers` and
 * `{1,3-4}` line ranges, as rehype-pretty-code reads them. Line numbers past
 * the end of the block are left out.
 * @internal Exported for its tests.
 */
export function parseFenceMeta(
	meta: string | null,
	codeLines: number,
): { title: string | null; showLineNumbers: boolean; highlightLines: number[] } {
	if (!meta) return { title: null, showLineNumbers: false, highlightLines: [] };
	const title = /(?:^|\s)title=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(meta);
	const showLineNumbers = /(?:^|\s)showLineNumbers(?:\{\d+\})?(?=\s|$)/.test(meta);
	const lines = new Set<number>();
	const last = Math.min(codeLines, MAX_HIGHLIGHT_LINES);
	for (const group of meta.matchAll(/(?:^|\s)\{([^}]*)\}/g)) {
		for (const part of group[1].split(",")) {
			const range = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
			if (!range) continue;
			const from = Number(range[1]);
			const to = Math.min(range[2] === undefined ? from : Number(range[2]), last);
			for (let line = Math.max(from, 1); line <= to; line++) lines.add(line);
		}
	}
	return {
		title: title ? (title[1] ?? title[2] ?? title[3] ?? null) : null,
		showLineNumbers,
		highlightLines: [...lines].sort((left, right) => left - right),
	};
}
