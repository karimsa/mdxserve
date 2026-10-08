import type { Root, RootContent } from "mdast";
import { toString } from "mdast-util-to-string";

/** Stable native-table identity from headers plus occurrence, independent of row edits. */
export function remarkTableIds() {
	return (tree: Root) => {
		const occurrences = new Map<string, number>();
		function visit(node: Root | RootContent) {
			if (node.type === "table") {
				const header = node.children[0].children.map((cell) => toString(cell)).join("\u001f");
				let hash = 2166136261;
				for (const character of header) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
				const signature = (hash >>> 0).toString(36);
				const occurrence = occurrences.get(signature) ?? 0;
				occurrences.set(signature, occurrence + 1);
				node.data = {
					...node.data,
					hProperties: {
						...node.data?.hProperties,
						id: `markdown-table-${signature}-${occurrence}`,
					},
				};
			}
			if ("children" in node) for (const child of node.children) visit(child as RootContent);
		}
		visit(tree);
	};
}
