import { mapNormalizedRange, type Resolution } from "./anchor";
import type { TreeBlocks } from "./tree-blocks";

/** A thread's highlight on one tree node: characters [start, end) of the node's `value`. */
export interface TextMark {
	start: number;
	end: number;
	threadId: string;
}

/** A stretch of a node's `value` and the threads highlighting all of it (none for unmarked text). */
export interface MarkPiece {
	start: number;
	end: number;
	threadIds: readonly string[];
}

/** Cuts [0, length) at every mark edge. Pieces are in order, do not overlap, and cover the whole. */
export function splitByMarks(length: number, marks: readonly TextMark[]): MarkPiece[] {
	const edges = new Set([0, length]);
	for (const mark of marks) {
		if (mark.end <= mark.start) continue;
		edges.add(Math.min(length, Math.max(0, mark.start)));
		edges.add(Math.min(length, Math.max(0, mark.end)));
	}
	const sorted = [...edges].sort((left, right) => left - right);
	const pieces: MarkPiece[] = [];
	for (let index = 0; index + 1 < sorted.length; index++) {
		const start = sorted[index];
		const end = sorted[index + 1];
		const threadIds = marks
			.filter((mark) => mark.start <= start && mark.end >= end && mark.end > mark.start)
			.map((mark) => mark.threadId);
		pieces.push({ start, end, threadIds });
	}
	return pieces;
}

/**
 * Per tree node, the marks every resolution puts on it: an `exact` one on the characters its
 * quote covers, a `block` one on all of the block's text. A string the tree has no node for (a
 * footnote's number) takes part in finding the quote and is never marked. Offsets are in the
 * node's `value`, never in the text the app shows: `mapNormalizedRange` starts a range on a
 * character that is not whitespace and ends it just after one, so a cut never falls inside a run
 * of whitespace the app collapses.
 */
export function marksOf(
	blocks: TreeBlocks,
	resolutions: ReadonlyMap<string, Resolution>,
): Map<object, TextMark[]> {
	const marks = new Map<object, TextMark[]>();
	function add(source: object | null, start: number, end: number, threadId: string): void {
		if (source === null || end <= start) return;
		const list = marks.get(source);
		if (list) list.push({ start, end, threadId });
		else marks.set(source, [{ start, end, threadId }]);
	}
	for (const [threadId, resolution] of resolutions) {
		if (resolution.state !== "exact" && resolution.state !== "block") continue;
		const block = blocks.blocks[resolution.block];
		if (!block) continue;
		if (resolution.state === "block") {
			block.nodes.forEach((text, node) => add(block.sources[node], 0, text.length, threadId));
			continue;
		}
		const range = mapNormalizedRange(block.nodes, resolution.start, resolution.end);
		if (!range) continue;
		for (let node = range.start.node; node <= range.end.node; node++) {
			const start = node === range.start.node ? range.start.offset : 0;
			const end = node === range.end.node ? range.end.offset : block.nodes[node].length;
			add(block.sources[node], start, end, threadId);
		}
	}
	return marks;
}
