import type { Root, RootContent, Table } from "mdast";
import { toString } from "mdast-util-to-string";

type TableIdentity = { node: Table; signature: string };

function signatureFor(headings: string[], table: Table): string {
	const identity = JSON.stringify([
		headings,
		table.children[0].children.map((cell) => toString(cell)),
	]);
	let hash = 2166136261;
	for (let index = 0; index < identity.length; index++)
		hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
	return (hash >>> 0).toString(36);
}

function collectTables(node: Root | RootContent, context: string[], tables: TableIdentity[]): void {
	if (node.type === "table") {
		tables.push({ node, signature: signatureFor(context, node) });
		return;
	}
	if (!("children" in node)) return;

	const headings = [...context];
	for (const child of node.children) {
		if (child.type === "heading") {
			headings.length = child.depth;
			headings[child.depth - 1] = toString(child);
		}
		collectTables(child as RootContent, headings, tables);
	}
}

/** Heading context survives table insertions; ambiguous identities never persist preferences. */
export function remarkTableIds() {
	return (tree: Root) => {
		const tables: TableIdentity[] = [];
		collectTables(tree, [], tables);
		const counts = new Map<string, number>();
		for (const { signature } of tables) counts.set(signature, (counts.get(signature) ?? 0) + 1);

		const occurrences = new Map<string, number>();
		for (const { node, signature } of tables) {
			const occurrence = occurrences.get(signature) ?? 0;
			occurrences.set(signature, occurrence + 1);
			const ambiguous = (counts.get(signature) ?? 0) > 1;
			node.data = {
				...node.data,
				hProperties: {
					...node.data?.hProperties,
					id: `markdown-table-v2-${signature}${ambiguous ? `-ambiguous-${occurrence}` : ""}`,
					...(ambiguous ? { "data-table-persist": "false" } : {}),
				},
			};
		}
	};
}
