import type {
	BlockNode,
	DocumentTree,
	InlineNode,
	TabNode,
	TocEntry,
} from "../../src/document/schema.js";

export type IdNode = BlockNode | InlineNode | TabNode;

/** Every node in the tree that carries a non-null `id`, in document order. */
export function idNodes(tree: DocumentTree): IdNode[] {
	const found: IdNode[] = [];
	const visit = (node: BlockNode | InlineNode | TabNode) => {
		if ("id" in node && typeof node.id === "string") found.push(node);
		if ("type" in node) {
			if (node.type === "tabs") node.tabs.forEach(visit);
			if (node.type === "list") node.items.forEach((item) => item.children.forEach(visit));
			if (node.type === "table") {
				node.head.flat().forEach(visit);
				node.rows.flat(2).forEach(visit);
			}
			if (node.type === "section") node.heading.forEach(visit);
		}
		if ("children" in node) (node.children as (BlockNode | InlineNode)[]).forEach(visit);
	};
	tree.children.forEach(visit);
	return found;
}

export function idsOf(tree: DocumentTree): string[] {
	return idNodes(tree).map((node) => (node as { id: string }).id);
}

export function findById(tree: DocumentTree, id: string): IdNode | undefined {
	return idNodes(tree).find((node) => (node as { id: string }).id === id);
}

export function tocIds(entries: TocEntry[]): string[] {
	return entries.flatMap((entry) => [entry.id, ...tocIds(entry.children)]);
}
