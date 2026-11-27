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
	/** Every footnote reference node, in document order. */
	footnoteReferences: readonly object[];
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
	const footnoteReferences: object[] = [];
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
				footnoteReferences.push(node);
				if (!footnoteNumbers.has(node.label))
					footnoteNumbers.set(node.label, footnoteNumbers.size + 1);
				return;
			case "footnoteDefinition":
				// Its content is walked below, once a reference makes it reachable.
				if (!definitions.has(node.label)) definitions.set(node.label, node);
				return;
			default:
				return;
		}
	}

	visitAll(document.children, []);
	// A footnote shows only when something references it, so references inside
	// an unused footnote never count. A Map's iteration also visits the labels
	// a footnote's own content adds, in the order GFM numbers them.
	for (const label of footnoteNumbers.keys()) {
		const definition = definitions.get(label);
		if (definition) visitAll(definition.children, []);
	}
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
		footnoteReferences,
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

/** A section id's own slug: its last segment that the server did not make up (`a>b>~2` is `b`). */
function ownSlug(id: string): string {
	const segments = id.split(">").filter((segment) => !segment.startsWith("~"));
	return segments.at(-1) ?? id;
}

/**
 * The id a URL fragment points at, or null when nothing matches:
 * 1. an exact id;
 * 2. the first section in the table of contents whose id ends with `>` plus
 *    the fragment, so `#examples` still lands on the first "Examples" heading
 *    after a second one turned both ids into paths, and not on a tab whose
 *    value happens to be `examples`;
 * 3. `<slug>-<n>`, the anchor earlier releases gave the repeats of a heading
 *    (`examples`, `examples-1`, `examples-2`): the `n`th section, in document
 *    order and counting from 0, whose own slug is `<slug>`.
 */
export function resolveFragment(
	fragment: string,
	index: Pick<DocumentIndex, "anchors" | "sectionLevels">,
	toc: readonly TocEntry[],
): string | null {
	if (fragment === "") return null;
	if (index.anchors.has(fragment)) return fragment;
	const suffix = `>${fragment}`;
	const bySuffix = flattenToc(toc).find(
		({ entry }) => entry.id.endsWith(suffix) && index.sectionLevels.has(entry.id),
	)?.entry.id;
	if (bySuffix) return bySuffix;
	const numbered = /^(.+)-(\d+)$/.exec(fragment);
	if (!numbered) return null;
	const [, slug, count] = numbered;
	const repeats = [...index.sectionLevels.keys()].filter((id) => ownSlug(id) === slug);
	return repeats[Number(count)] ?? null;
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
