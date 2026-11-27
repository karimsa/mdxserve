import { diffLines, diffWordsWithSpace } from "diff";

/*
 * Diff computation, shared by both clients' renderers (Diff.tsx, diff-rows.tsx and
 * diff-rows.web.tsx). Pure: `computeDiff(before, after, context)` is the entry point, so it can
 * be exercised without mounting anything.
 */

export type DiffRowKind = "context" | "add" | "del";

interface DiffSegment {
	text: string;
	changed: boolean;
}

export interface DiffRow {
	kind: DiffRowKind;
	oldNo?: number;
	newNo?: number;
	text: string;
	segments?: DiffSegment[];
	/** True when this del/add line has a similar counterpart in the adjacent block. */
	paired?: boolean;
	/** For paired lines: index of the add line (within its block) this row is matched to. */
	pairId?: number;
}

export type DiffHunkRow = DiffRow | { kind: "collapsed"; count: number; rows: DiffRow[] };

interface DiffComputation {
	rows: DiffHunkRow[];
	additions: number;
	deletions: number;
}

function stripTrailingNewline(text: string): string {
	return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/** Split a jsdiff line-change value into individual lines, dropping the
 * trailing empty entry produced by a value that itself ends in "\n". */
function splitLines(value: string): string[] {
	const lines = value.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

/**
 * Word-level diff between two lines known to differ. Returns per-side
 * segments only when the changed portion is under ~60% of the line (GitHub's
 * rule of thumb) — beyond that, intra-line highlighting is more noise than
 * signal, so the whole line is just left as a plain add/del row.
 */
function pairLine(
	oldLine: string,
	newLine: string,
): { delSegments?: DiffSegment[]; addSegments?: DiffSegment[] } {
	const tokens = diffWordsWithSpace(oldLine, newLine);
	const delSegments: DiffSegment[] = [];
	const addSegments: DiffSegment[] = [];
	let changedLen = 0;
	let totalLen = 0;

	for (const token of tokens) {
		totalLen += token.value.length;
		if (token.added) {
			addSegments.push({ text: token.value, changed: true });
			changedLen += token.value.length;
		} else if (token.removed) {
			delSegments.push({ text: token.value, changed: true });
			changedLen += token.value.length;
		} else {
			delSegments.push({ text: token.value, changed: false });
			addSegments.push({ text: token.value, changed: false });
		}
	}

	const ratio = totalLen === 0 ? 0 : changedLen / totalLen;
	if (ratio >= 0.6) return {};
	return { delSegments, addSegments };
}

/** 0..1 similarity of two lines: Dice ratio of shared word-token length (whitespace ignored). */
function lineSimilarity(left: string, right: string): number {
	const ta = left.trim();
	const tb = right.trim();
	if (ta === tb) return 1;
	if (!ta || !tb) return 0;
	const nonWs = (text: string) => text.replace(/\s+/g, "").length;
	let shared = 0;
	for (const token of diffWordsWithSpace(ta, tb)) {
		if (!token.added && !token.removed) shared += nonWs(token.value);
	}
	const denom = nonWs(ta) + nonWs(tb);
	return denom === 0 ? 0 : (2 * shared) / denom;
}

/**
 * Order-preserving alignment of removed lines to added lines (classic
 * sequence-alignment DP on similarity), keeping only pairs that are clearly
 * related. Returns [delIndex, addIndex] pairs in ascending order.
 */
function alignLines(dels: string[], adds: string[]): Array<[number, number]> {
	const MIN = 0.65;
	const delCount = dels.length;
	const addCount = adds.length;
	if (delCount === 0 || addCount === 0) return [];
	// Cap the quadratic work for very large blocks: fall back to positional pairing.
	if (delCount * addCount > 40_000)
		return Array.from(
			{ length: Math.min(delCount, addCount) },
			(_, index) => [index, index] as [number, number],
		);
	const sim: number[][] = dels.map((delLine) =>
		adds.map((addLine) => lineSimilarity(delLine, addLine)),
	);
	const score: number[][] = Array.from({ length: delCount + 1 }, () =>
		new Array<number>(addCount + 1).fill(0),
	);
	for (let delIndex = 1; delIndex <= delCount; delIndex++) {
		for (let addIndex = 1; addIndex <= addCount; addIndex++) {
			const similarity = sim[delIndex - 1][addIndex - 1];
			const diag = score[delIndex - 1][addIndex - 1] + (similarity >= MIN ? similarity : 0);
			score[delIndex][addIndex] = Math.max(
				diag,
				score[delIndex - 1][addIndex],
				score[delIndex][addIndex - 1],
			);
		}
	}
	const pairs: Array<[number, number]> = [];
	let delIndex = delCount;
	let addIndex = addCount;
	while (delIndex > 0 && addIndex > 0) {
		const similarity = sim[delIndex - 1][addIndex - 1];
		if (
			similarity >= MIN &&
			score[delIndex][addIndex] === score[delIndex - 1][addIndex - 1] + similarity
		) {
			pairs.push([delIndex - 1, addIndex - 1]);
			delIndex--;
			addIndex--;
		} else if (score[delIndex - 1][addIndex] >= score[delIndex][addIndex - 1]) {
			delIndex--;
		} else {
			addIndex--;
		}
	}
	return pairs.reverse();
}

/**
 * Flatten jsdiff's `diffLines` change objects (each covering a run of one or
 * more lines) into one row per line, pairing up same-length removed/added
 * blocks so they can share intra-line highlights and sit on one row in the
 * split view.
 */
function flattenChanges(
	before: string,
	after: string,
): { rows: DiffRow[]; additions: number; deletions: number } {
	const changes = diffLines(stripTrailingNewline(before), stripTrailingNewline(after));
	const rows: DiffRow[] = [];
	let oldNo = 1;
	let newNo = 1;
	let additions = 0;
	let deletions = 0;
	let index = 0;

	while (index < changes.length) {
		const change = changes[index];
		const next = changes[index + 1];

		if (change.removed && next?.added) {
			// A removed block directly followed by an added block: emit all removed
			// lines, then all added lines (GitHub's unified ordering). Lines are
			// paired by similarity (order-preserving) so near-identical lines get
			// intra-line highlights and sit side by side in the split view.
			const delLines = splitLines(change.value);
			const addLines = splitLines(next.value);
			const matches = alignLines(delLines, addLines);
			const delRows: DiffRow[] = [];
			const addRows: DiffRow[] = [];
			const pairedDel = new Map<number, number>();
			for (const [delIndex, addIndex] of matches) pairedDel.set(delIndex, addIndex);
			const pairedAdd = new Set(matches.map(([, addIndex]) => addIndex));
			const segmentsFor = new Map<number, ReturnType<typeof pairLine>>();
			for (const [delIndex, addIndex] of matches)
				segmentsFor.set(delIndex, pairLine(delLines[delIndex], addLines[addIndex]));
			for (let delIndex = 0; delIndex < delLines.length; delIndex++) {
				const seg = segmentsFor.get(delIndex);
				delRows.push({
					kind: "del",
					oldNo: oldNo++,
					text: delLines[delIndex],
					segments: seg?.delSegments,
					paired: pairedDel.has(delIndex),
					pairId: pairedDel.get(delIndex),
				});
			}
			for (let addIndex = 0; addIndex < addLines.length; addIndex++) {
				const delIndex = [...pairedDel.entries()].find(([, pa]) => pa === addIndex)?.[0];
				const seg = delIndex === undefined ? undefined : segmentsFor.get(delIndex);
				addRows.push({
					kind: "add",
					newNo: newNo++,
					text: addLines[addIndex],
					segments: seg?.addSegments,
					paired: pairedAdd.has(addIndex),
					pairId: addIndex,
				});
			}
			rows.push(...delRows, ...addRows);
			deletions += delLines.length;
			additions += addLines.length;
			index += 2;
			continue;
		}

		if (change.removed) {
			for (const line of splitLines(change.value)) {
				rows.push({ kind: "del", oldNo: oldNo++, text: line });
				deletions++;
			}
			index++;
			continue;
		}

		if (change.added) {
			for (const line of splitLines(change.value)) {
				rows.push({ kind: "add", newNo: newNo++, text: line });
				additions++;
			}
			index++;
			continue;
		}

		for (const line of splitLines(change.value)) {
			rows.push({ kind: "context", oldNo: oldNo++, newNo: newNo++, text: line });
		}
		index++;
	}

	return { rows, additions, deletions };
}

/**
 * Collapse long runs of context rows into `{ kind: "collapsed" }` markers.
 * A run between two changes collapses once it's longer than `2 * context`
 * (keeping `context` lines visible on each side); a run at the very start or
 * end of the diff (no change on one side) collapses once longer than
 * `context`, keeping only the side nearest a change visible.
 */
function groupHunks(rows: DiffRow[], context: number): DiffHunkRow[] {
	const result: DiffHunkRow[] = [];
	let index = 0;

	while (index < rows.length) {
		const row = rows[index];
		if (row.kind !== "context") {
			result.push(row);
			index++;
			continue;
		}

		let runEnd = index;
		while (runEnd < rows.length && rows[runEnd].kind === "context") runEnd++;
		const run = rows.slice(index, runEnd);
		const isLeading = index === 0;
		const isTrailing = runEnd === rows.length;

		if (isLeading && isTrailing) {
			if (run.length > 2 * context) {
				result.push(...run.slice(0, context));
				const hidden = run.slice(context, run.length - context);
				if (hidden.length > 0)
					result.push({ kind: "collapsed", count: hidden.length, rows: hidden });
				result.push(...run.slice(run.length - context));
			} else {
				result.push(...run);
			}
		} else if (isLeading) {
			if (run.length > context) {
				const hidden = run.slice(0, run.length - context);
				result.push({ kind: "collapsed", count: hidden.length, rows: hidden });
				result.push(...run.slice(run.length - context));
			} else {
				result.push(...run);
			}
		} else if (isTrailing) {
			if (run.length > context) {
				result.push(...run.slice(0, context));
				const hidden = run.slice(context);
				result.push({ kind: "collapsed", count: hidden.length, rows: hidden });
			} else {
				result.push(...run);
			}
		} else {
			if (run.length > 2 * context) {
				result.push(...run.slice(0, context));
				const hidden = run.slice(context, run.length - context);
				result.push({ kind: "collapsed", count: hidden.length, rows: hidden });
				result.push(...run.slice(run.length - context));
			} else {
				result.push(...run);
			}
		}

		index = runEnd;
	}

	return result;
}

export function computeDiff(before: string, after: string, context: number): DiffComputation {
	const { rows, additions, deletions } = flattenChanges(before, after);
	return { rows: groupHunks(rows, context), additions, deletions };
}

type FlatItem = DiffRow | { kind: "collapsed"; index: number; count: number };

/** Replace still-collapsed markers with a stand-in that carries their
 * original index (for the expand click handler); splice expanded ones'
 * hidden rows directly back into the flow. */
function applyExpansion(rows: DiffHunkRow[], expanded: Set<number>): FlatItem[] {
	const out: FlatItem[] = [];
	rows.forEach((row, index) => {
		if (row.kind === "collapsed") {
			if (expanded.has(index)) out.push(...row.rows);
			else out.push({ kind: "collapsed", index, count: row.count });
		} else {
			out.push(row);
		}
	});
	return out;
}

export type Block =
	{ type: "rows"; rows: DiffRow[] } | { type: "separator"; index: number; count: number };

/** Group a flattened, expansion-applied item list into runs of plain rows
 * and lone separators, so a separator can render full-width while
 * everything else renders as an aligned table. */
function partitionBlocks(items: FlatItem[]): Block[] {
	const blocks: Block[] = [];
	let current: DiffRow[] = [];
	for (const item of items) {
		if (item.kind === "collapsed") {
			if (current.length > 0) {
				blocks.push({ type: "rows", rows: current });
				current = [];
			}
			blocks.push({ type: "separator", index: item.index, count: item.count });
		} else {
			current.push(item);
		}
	}
	if (current.length > 0) blocks.push({ type: "rows", rows: current });
	return blocks;
}

/** The rows of `rows` to draw, with the separators still collapsed, in blocks. */
export function visibleBlocks(rows: DiffHunkRow[], expanded: Set<number>): Block[] {
	return partitionBlocks(applyExpansion(rows, expanded));
}

export function rowClasses(kind: DiffRowKind): { row: string; gutter: string; text: string } {
	if (kind === "add")
		return { row: "bg-status-ok-bg", gutter: "text-status-ok-fg", text: "text-status-ok-fg" };
	if (kind === "del")
		return {
			row: "bg-status-danger-bg",
			gutter: "text-status-danger-fg",
			text: "text-status-danger-fg",
		};
	return { row: "", gutter: "text-code-gutter", text: "text-code-fg" };
}

export function marker(kind: DiffRowKind): string {
	return kind === "add" ? "+" : kind === "del" ? "−" : " ";
}

export interface SplitRow {
	left?: DiffRow;
	right?: DiffRow;
}

export function toSplitRows(rows: DiffRow[]): SplitRow[] {
	const out: SplitRow[] = [];
	let index = 0;
	while (index < rows.length) {
		const row = rows[index];
		if (row.kind === "context") {
			out.push({ left: row, right: row });
			index++;
			continue;
		}
		// Collect the run of removed lines and the run of added lines that
		// follows it. Paired lines (matched by similarity) share a row; the
		// unpaired lines between them render against an empty cell, preserving
		// order on both sides.
		const dels: DiffRow[] = [];
		const adds: DiffRow[] = [];
		while (index < rows.length && rows[index].kind === "del") dels.push(rows[index++]);
		while (index < rows.length && rows[index].kind === "add") adds.push(rows[index++]);
		let addIndex = 0;
		for (const del of dels) {
			if (del.paired && del.pairId !== undefined) {
				while (addIndex < del.pairId) out.push({ right: adds[addIndex++] });
				out.push({ left: del, right: adds[addIndex++] });
			} else {
				out.push({ left: del });
			}
		}
		while (addIndex < adds.length) out.push({ right: adds[addIndex++] });
	}
	return out;
}
