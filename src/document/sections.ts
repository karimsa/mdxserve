import type { Heading, RootContent } from "mdast";
import type { HeadingLevel } from "./schema.js";

/**
 * A chunk of the source that failed to parse on its own during the fallback
 * parse. It stands in the mdast where the chunk's content would have been,
 * and becomes an `error` node in the tree.
 */
export interface FailedChunk {
	type: "mdxserveFailedChunk";
	/** The parser's message. */
	message: string;
	/** The chunk's source text, as written. */
	source: string;
	/** Text of the h1/h2 heading line that starts the chunk, or null for the first chunk. */
	headingText: string | null;
	/** Level of that heading; the first chunk, which has no heading, counts as 1. */
	level: 1 | 2;
	startLine: number;
	endLine: number;
}

/** A node in a block container: what remark produced, or a failed chunk. */
export type FlowNode = RootContent | FailedChunk;

export type SectionItem =
	| {
			kind: "section";
			heading: Heading;
			level: HeadingLevel;
			/** The editable range: see `buildSections`. Undefined when the heading has no position. */
			startLine: number | undefined;
			endLine: number | undefined;
			children: SectionItem[];
	  }
	| { kind: "node"; node: FlowNode };

/**
 * Group the nodes of one block container into sections. A heading opens a
 * section that runs to the next heading of the same or a higher level; a
 * failed chunk closes the sections at or below its level and stays a plain
 * node. Nodes before the first heading stay at the top.
 *
 * Each section also gets its editable line range. It starts at the heading
 * line and ends on the line before the next heading of level 1 or 2 (for a
 * section of level 1 or 2) or of the same or a higher level (for 3 to 6) in
 * this container, a failed chunk counting as a heading of its level. With no
 * such heading it ends at `containerEndLine`.
 */
export function buildSections(nodes: FlowNode[], containerEndLine: number): SectionItem[] {
	const result: SectionItem[] = [];
	const open: Extract<SectionItem, { kind: "section" }>[] = [];

	nodes.forEach((node, index) => {
		const level = boundaryLevel(node);
		if (level !== null) {
			while (open.length > 0 && open[open.length - 1].level >= level) open.pop();
		}
		const parent = open.length > 0 ? open[open.length - 1].children : result;
		if (node.type === "heading") {
			const startLine = node.position?.start.line;
			const section: Extract<SectionItem, { kind: "section" }> = {
				kind: "section",
				heading: node,
				level: node.depth as HeadingLevel,
				startLine,
				endLine:
					startLine === undefined
						? undefined
						: Math.max(startLine, sectionEnd(nodes, index, node.depth, containerEndLine)),
				children: [],
			};
			parent.push(section);
			open.push(section);
			return;
		}
		parent.push({ kind: "node", node });
	});
	return result;
}

function boundaryLevel(node: FlowNode): number | null {
	if (node.type === "heading") return node.depth;
	if (node.type === "mdxserveFailedChunk") return node.level;
	return null;
}

function sectionEnd(
	nodes: FlowNode[],
	index: number,
	depth: number,
	containerEndLine: number,
): number {
	const threshold = depth <= 2 ? 2 : depth;
	for (let next = index + 1; next < nodes.length; next++) {
		const level = boundaryLevel(nodes[next]);
		if (level === null || level > threshold) continue;
		const start = startLineOf(nodes[next]);
		if (start !== undefined) return start - 1;
	}
	return containerEndLine;
}

export function startLineOf(node: FlowNode): number | undefined {
	if (node.type === "mdxserveFailedChunk") return node.startLine;
	return node.position?.start.line;
}

/**
 * The last line a node occupies. A position ending at column 1 of a line ends
 * on the line before (a fence at the end of the file after its newline).
 */
export function endLineOf(node: FlowNode): number | undefined {
	if (node.type === "mdxserveFailedChunk") return node.endLine;
	const end = node.position?.end;
	if (!end) return undefined;
	const start = node.position?.start.line ?? end.line;
	return Math.max(start, end.column === 1 ? end.line - 1 : end.line);
}
