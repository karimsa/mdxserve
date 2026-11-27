import type { Root } from "mdast";
import { tableIdentities } from "../../document/table-ids.js";

/** Heading context survives table insertions; ambiguous identities never persist preferences. */
export function remarkTableIds() {
	return (tree: Root) => {
		for (const [node, { id, persist }] of tableIdentities(tree)) {
			node.data = {
				...node.data,
				hProperties: {
					...node.data?.hProperties,
					id,
					...(persist ? {} : { "data-table-persist": "false" }),
				},
			};
		}
	};
}
