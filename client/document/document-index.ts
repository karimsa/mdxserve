// Type-only: src/ is never served to the browser.
import type {
	BlockNode,
	DocumentTree,
	FootnoteDefinitionNode,
	InlineNode,
	TocEntry,
} from "./tree-types";

/** One `Tabs` and the value that must be selected in it for a node to show. */
export interface TabStep {
	tabsId: string;
	value: string;
}

export interface DocumentIndex {
	/** For every node with an id: the tabs to select, outermost first, for it to be visible. */
	tabSteps: ReadonlyMap<string, readonly TabStep[]>;
	/** The heading level of every section, by id. */
	sectionLevels: ReadonlyMap<string, number>;
	/** The ids a URL fragment can name: sections, tabs and failed sections. */
	anchors: ReadonlySet<string>;
	/** Footnote numbers by label, in the order their first reference appears. */
	footnoteNumbers: ReadonlyMap<string, number>;
	/** How many times each footnote is referenced. */
	footnoteReferenceCounts: ReadonlyMap<string, number>;
	/** Each reference node's position among the references to its footnote, from 1. */
	footnoteOccurrences: WeakMap<object, number>;
	/** Each referenced footnote's definition, in number order. */
	footnotes: readonly FootnoteDefinitionNode[];
}

type AnyNode = BlockNode | InlineNode;

/** Walk the tree once and collect what navigation and footnotes need. */
export function indexDocument(document: DocumentTree): DocumentIndex {
	const tabSteps = new Map<string, readonly TabStep[]>();
	const sectionLevels = new Map<string, number>();
	const anchors = new Set<string>();
	const footnoteNumbers = new Map<string, number>();
	const footnoteReferenceCounts = new Map<string, number>();
	const footnoteOccurrences = new WeakMap<object, number>();
	const definitions = new Map<string, FootnoteDefinitionNode>();

	function visitAll(nodes: readonly AnyNode[], steps: readonly TabStep[]): void {
		for (const node of nodes) visit(node, steps);
	}

	function visit(node: AnyNode, steps: readonly TabStep[]): void {
		switch (node.type) {
			case "section":
				tabSteps.set(node.id, steps);
				sectionLevels.set(node.id, node.level);
				anchors.add(node.id);
				visitAll(node.heading, steps);
				visitAll(node.children, steps);
				return;
			case "preamble":
				tabSteps.set(node.id, steps);
				visitAll(node.children, steps);
				return;
			case "error":
				tabSteps.set(node.id, steps);
				anchors.add(node.id);
				return;
			case "tabs":
				tabSteps.set(node.id, steps);
				for (const tab of node.tabs) {
					const inner = [...steps, { tabsId: node.id, value: tab.value }];
					tabSteps.set(tab.id, inner);
					anchors.add(tab.id);
					visitAll(tab.children, inner);
				}
				return;
			case "component":
			case "element":
				if (node.id !== null) tabSteps.set(node.id, steps);
				visitAll(node.children, steps);
				return;
			case "code":
				if (node.id !== null) tabSteps.set(node.id, steps);
				return;
			case "paragraph":
			case "emphasis":
			case "strong":
			case "delete":
			case "link":
			case "blockquote":
				visitAll(node.children, steps);
				return;
			case "list":
				for (const item of node.items) visitAll(item.children, steps);
				return;
			case "table":
				for (const cell of node.head) visitAll(cell, steps);
				for (const row of node.rows) for (const cell of row) visitAll(cell, steps);
				return;
			case "footnoteReference":
				footnoteReferenceCounts.set(node.label, (footnoteReferenceCounts.get(node.label) ?? 0) + 1);
				footnoteOccurrences.set(node, footnoteReferenceCounts.get(node.label) ?? 1);
				if (!footnoteNumbers.has(node.label))
					footnoteNumbers.set(node.label, footnoteNumbers.size + 1);
				return;
			case "footnoteDefinition":
				if (!definitions.has(node.label)) definitions.set(node.label, node);
				visitAll(node.children, steps);
				return;
			default:
				return;
		}
	}

	visitAll(document.children, []);
	const footnotes = [...footnoteNumbers.keys()].flatMap((label) => {
		const definition = definitions.get(label);
		return definition ? [definition] : [];
	});
	return {
		tabSteps,
		sectionLevels,
		anchors,
		footnoteNumbers,
		footnoteReferenceCounts,
		footnoteOccurrences,
		footnotes,
	};
}

/** Table of contents entries in reading order, depth first. */
export function flattenToc(
	entries: readonly TocEntry[],
	depth = 0,
): { entry: TocEntry; depth: number }[] {
	return entries.flatMap((entry) => [{ entry, depth }, ...flattenToc(entry.children, depth + 1)]);
}

/**
 * The id a URL fragment points at: an exact id first; otherwise the first
 * table of contents entry whose id ends with `>` plus the fragment, so a link
 * written as `#examples` still lands after a second "Examples" heading turned
 * both ids into paths. Null when nothing matches.
 */
export function resolveFragment(
	fragment: string,
	index: Pick<DocumentIndex, "anchors">,
	toc: readonly TocEntry[],
): string | null {
	if (fragment === "") return null;
	if (index.anchors.has(fragment)) return fragment;
	const suffix = `>${fragment}`;
	return flattenToc(toc).find(({ entry }) => entry.id.endsWith(suffix))?.entry.id ?? null;
}

/** Decode a `location.hash` (with or without its `#`); a malformed escape is taken literally. */
export function fragmentOf(hash: string): string {
	const raw = hash.startsWith("#") ? hash.slice(1) : hash;
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}
