import type { BlockNode, DocumentTree, TreeNode } from "@mdxserve/client/document/tree-types";
import type { ListItemNode } from "@mdxserve/ui/document/environment";

/**
 * Where a task item's box is in the file: the node whose source lines hold it (the innermost
 * section, or the preamble), which task of that node's lines it is, counting from 0, and how
 * many tasks those lines hold. `getNodeSource` and `saveDocNode` read and replace those lines.
 */
export interface TaskPlace {
	ownerId: string;
	ordinal: number;
	count: number;
}

/**
 * The children whose lines `getNodeSource` returns with a section's: all of them, except that a
 * level 1 section stops at its first level 1 or 2 subsection, which is a unit of its own (the
 * server's range table, which the web's section editor follows too).
 */
function linesOf(node: Extract<BlockNode, { type: "section" | "preamble" }>): readonly BlockNode[] {
	if (node.type !== "section" || node.level !== 1) return node.children;
	const split = node.children.findIndex((child) => child.type === "section" && child.level <= 2);
	return split === -1 ? node.children : node.children.slice(0, split);
}

/** Each task list item's place, by item object. An item outside every section and preamble has none. */
export function taskPlaces(tree: DocumentTree): WeakMap<ListItemNode, TaskPlace> {
	const places = new WeakMap<ListItemNode, TaskPlace>();

	/** The task items under `nodes`, in document order. */
	function tasksIn(nodes: readonly unknown[], into: ListItemNode[]): ListItemNode[] {
		for (const node of nodes) {
			if (node === null || typeof node !== "object") continue;
			const record = node as Record<string, unknown>;
			if (record.type === "list") {
				for (const item of record.items as ListItemNode[]) {
					if (item.checked !== null) into.push(item);
					tasksIn(item.children, into);
				}
				continue;
			}
			if (record.type === "tabs") {
				for (const tab of record.tabs as { children: BlockNode[] }[]) tasksIn(tab.children, into);
				continue;
			}
			if (Array.isArray(record.children)) tasksIn(record.children, into);
		}
		return into;
	}

	function visit(nodes: readonly TreeNode[]): void {
		for (const node of nodes) {
			if (node.type !== "section" && node.type !== "preamble") {
				// A section nested in a builtin or a tab is its own owner too.
				if ("children" in node && Array.isArray(node.children)) visit(node.children as TreeNode[]);
				if (node.type === "tabs") for (const tab of node.tabs) visit(tab.children);
				continue;
			}
			// Inner sections run later and claim their own tasks.
			const tasks = tasksIn(linesOf(node), []);
			tasks.forEach((item, ordinal) =>
				places.set(item, { ownerId: node.id, ordinal, count: tasks.length }),
			);
			visit(node.children);
		}
	}

	visit(tree.children);
	return places;
}

/** A task marker after any blockquote markers, indentation and the list item's own marker. */
const TASK = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[([ xX])\](?=[ \t]|$)/;
/** A code fence's opening run, also right after a list item's marker. */
const FENCE = /^(?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/;

/** Comments that can span lines and hide what looks like a task: HTML, and an MDX expression's. */
const COMMENTS = [
	["<!--", "-->"],
	["{/*", "*/}"],
] as const;

export type TaskEdit =
	| { kind: "ok"; markdown: string }
	/** The lines do not hold the task the tree describes: the file changed, or the scan cannot tell. */
	| { kind: "mismatch" };

/**
 * Set the `ordinal`th task box of a node's source lines to `checked`. The lines must hold
 * exactly `count` task boxes outside code fences and comments, and that box must still be
 * `!checked`; anything else is a mismatch and nothing is written. Nothing but the one character
 * inside the brackets changes.
 */
export function setTaskInSource(
	markdown: string,
	place: Pick<TaskPlace, "ordinal" | "count">,
	checked: boolean,
): TaskEdit {
	const lines = markdown.split("\n");
	const boxes: { line: number; column: number; checked: boolean }[] = [];
	let fence: { marker: string; length: number } | null = null;
	// The end of the comment the scan is inside, HTML's or an MDX expression comment's.
	let commentEnd: string | null = null;
	lines.forEach((line, index) => {
		if (fence) {
			const close = FENCE.exec(line);
			if (
				close &&
				close[1][0] === fence.marker &&
				close[1].length >= fence.length &&
				close[2].trim() === ""
			)
				fence = null;
			return;
		}
		if (commentEnd !== null) {
			if (line.includes(commentEnd)) commentEnd = null;
			return;
		}
		const open = FENCE.exec(line);
		if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
			fence = { marker: open[1][0], length: open[1].length };
			return;
		}
		const task = TASK.exec(line);
		if (task) {
			boxes.push({ line: index, column: task[1].length + 1, checked: task[2] !== " " });
		}
		for (const [start, end] of COMMENTS) {
			const at = line.lastIndexOf(start);
			if (at !== -1 && !line.slice(at).includes(end)) commentEnd = end;
		}
	});
	if (boxes.length !== place.count) return { kind: "mismatch" };
	const box = boxes[place.ordinal];
	if (!box || box.checked === checked) return { kind: "mismatch" };
	const line = lines[box.line];
	lines[box.line] =
		`${line.slice(0, box.column)}${checked ? "x" : " "}${line.slice(box.column + 1)}`;
	return { kind: "ok", markdown: lines.join("\n") };
}
