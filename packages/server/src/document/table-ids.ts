import type { Root, RootContent, Table } from "mdast";
import { toString } from "mdast-util-to-string";

export interface TableIdentity {
	/** `markdown-table-v2-<hash>`, plus `-ambiguous-<n>` when another table hashes the same. */
	id: string;
	/** False when the id is ambiguous, so table preferences must not be kept under it. */
	persist: boolean;
}

type TableSignature = { node: Table; signature: string };

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

function collectTables(
	node: Root | RootContent,
	context: string[],
	tables: TableSignature[],
): void {
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

/**
 * The id of every Markdown table in `tree`: a hash of the headings above it
 * and its header row, so inserting another table elsewhere leaves it alone.
 * Two tables with the same hash both get an ambiguous id that never persists
 * preferences.
 */
export function tableIdentities(tree: Root): Map<Table, TableIdentity> {
	const tables: TableSignature[] = [];
	collectTables(tree, [], tables);
	const counts = new Map<string, number>();
	for (const { signature } of tables) counts.set(signature, (counts.get(signature) ?? 0) + 1);

	const occurrences = new Map<string, number>();
	const identities = new Map<Table, TableIdentity>();
	for (const { node, signature } of tables) {
		const occurrence = occurrences.get(signature) ?? 0;
		occurrences.set(signature, occurrence + 1);
		const ambiguous = (counts.get(signature) ?? 0) > 1;
		identities.set(node, {
			id: `markdown-table-v2-${signature}${ambiguous ? `-ambiguous-${occurrence}` : ""}`,
			persist: !ambiguous,
		});
	}
	return identities;
}
