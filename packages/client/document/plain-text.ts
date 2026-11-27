import type { TreeNode } from "./tree-types";

/** The text a reader sees in `nodes`: text and inline code, through every container. */
export function plainText(nodes: readonly TreeNode[]): string {
	let text = "";
	for (const node of nodes) {
		switch (node.type) {
			case "text":
			case "inlineCode":
				text += node.value;
				break;
			case "emphasis":
			case "strong":
			case "delete":
			case "link":
			case "component":
			case "element":
			case "paragraph":
				text += plainText(node.children);
				break;
			default:
				break;
		}
	}
	return text;
}
