import type {
	BlockNode,
	DocumentTree,
	SectionNode,
	TreeNode,
} from "@mdxserve/client/document/tree-types";

/** One row of the document's list: the nodes it draws, keyed so a refetch keeps its place. */
export interface DocumentRow {
	key: string;
	nodes: readonly TreeNode[];
}

export interface DocumentRows {
	rows: readonly DocumentRow[];
	/** The row each node id is drawn in: a heading's own row, or the block that holds the node. */
	rowOf: ReadonlyMap<string, number>;
	/**
	 * The row of each node a row is made from: a section (its heading's row) or a top-level
	 * block. It is what `collectTreeBlocks` names as a block's `container`.
	 */
	rowOfNode: WeakMap<object, number>;
}

/** A section with its heading only, for the heading's row; one object per section object. */
const headings = new WeakMap<SectionNode, SectionNode>();
/** One `nodes` array per block object, so an unchanged block's row keeps its props. */
const singles = new WeakMap<TreeNode, readonly TreeNode[]>();

function headingOf(section: SectionNode): SectionNode {
	let heading = headings.get(section);
	if (!heading) {
		heading = { ...section, children: [] };
		headings.set(section, heading);
	}
	return heading;
}

function single(node: TreeNode): readonly TreeNode[] {
	let nodes = singles.get(node);
	if (!nodes) {
		nodes = [node];
		singles.set(node, nodes);
	}
	return nodes;
}

/** Every node id inside `node`, itself included: tabs, headings in tabs, builtins, errors. */
function idsIn(node: unknown, found: string[]): string[] {
	if (node === null || typeof node !== "object") return found;
	if (Array.isArray(node)) {
		for (const child of node) idsIn(child, found);
		return found;
	}
	const record = node as Record<string, unknown>;
	if (typeof record.id === "string") found.push(record.id);
	for (const field of ["children", "heading", "tabs", "items"] as const)
		idsIn(record[field], found);
	return found;
}

/**
 * The tree as a list of rows for a virtualised list (N2). A section is drawn flat, its heading
 * and then its children, as the shared renderer draws it, so a document that is one long
 * `# Title` section still becomes one row per block rather than one row in all. The preamble
 * is flattened the same way. Every other block is one row, footnote definitions excepted: they
 * are drawn with the footnotes at the end.
 */
export function documentRows(tree: DocumentTree): DocumentRows {
	const rows: DocumentRow[] = [];
	const rowOf = new Map<string, number>();
	const rowOfNode = new WeakMap<object, number>();

	function add(nodes: readonly BlockNode[], parentKey: string): void {
		nodes.forEach((node, index) => {
			const id = "id" in node && typeof node.id === "string" ? node.id : null;
			const key = id === null ? `${parentKey}/${index}` : `#${id}`;
			if (node.type === "section") {
				rowOf.set(node.id, rows.length);
				rowOfNode.set(node, rows.length);
				for (const inner of idsIn(node.heading, [])) rowOf.set(inner, rows.length);
				rows.push({ key, nodes: single(headingOf(node)) });
				add(node.children, key);
				return;
			}
			if (node.type === "preamble") {
				rowOf.set(node.id, rows.length);
				add(node.children, key);
				return;
			}
			if (node.type === "footnoteDefinition") return;
			for (const inner of idsIn(node, [])) if (!rowOf.has(inner)) rowOf.set(inner, rows.length);
			rowOfNode.set(node, rows.length);
			rows.push({ key, nodes: single(node) });
		});
	}

	add(tree.children, "");
	return { rows, rowOf, rowOfNode };
}

/**
 * The kind of view a row draws, for the list's recycling: a Mermaid block is "diagram", so its
 * row (and the WebView in it, with Mermaid already parsed) is reused only for another diagram.
 */
export function rowType(row: DocumentRow): string {
	const first = row.nodes[0];
	if (!first) return "row";
	return first.type === "code" && first.lang === "mermaid" ? "diagram" : first.type;
}
