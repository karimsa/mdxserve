import { useId, useState } from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { diffLines, diffWordsWithSpace } from "diff";
import { enterTransition } from "../motion";
import { CrossFade } from "../CrossFade";

export const diffProps = z.object({
	before: z.string().describe("Original text."),
	after: z.string().describe("New text."),
	language: z
		.string()
		.optional()
		.describe(
			"Label only, shown in the header when `title` isn't set. Shown as a label; the diff is colored by " +
				"change, not by syntax — Shiki runs at build time for fenced code blocks, not for runtime strings " +
				"passed to this component.",
		),
	title: z
		.string()
		.optional()
		.describe("Filename or heading shown in the header; takes precedence over `language`."),
	view: z.enum(["unified", "split"]).default("unified").describe("Initial view."),
	context: z
		.number()
		.int()
		.min(0)
		.default(3)
		.describe(
			"Unchanged lines kept around each change; longer unchanged runs collapse into an expandable separator.",
		),
});

export type DiffProps = z.infer<typeof diffProps>;

/*
 * Diff computation
 * -----------------
 * Pure and unit-testable: `computeDiff(before, after, context)` is the only
 * entry point React code needs, so it can be exercised without mounting
 * anything.
 */

export type DiffRowKind = "context" | "add" | "del";

export interface DiffSegment {
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

export interface DiffComputation {
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
function lineSimilarity(a: string, b: string): number {
	const ta = a.trim();
	const tb = b.trim();
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
	const n = dels.length;
	const m = adds.length;
	if (n === 0 || m === 0) return [];
	// Cap the quadratic work for very large blocks: fall back to positional pairing.
	if (n * m > 40_000)
		return Array.from({ length: Math.min(n, m) }, (_, k) => [k, k] as [number, number]);
	const sim: number[][] = dels.map((d) => adds.map((a) => lineSimilarity(d, a)));
	const score: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = 1; i <= n; i++) {
		for (let j = 1; j <= m; j++) {
			const s = sim[i - 1][j - 1];
			const diag = score[i - 1][j - 1] + (s >= MIN ? s : 0);
			score[i][j] = Math.max(diag, score[i - 1][j], score[i][j - 1]);
		}
	}
	const pairs: Array<[number, number]> = [];
	let i = n;
	let j = m;
	while (i > 0 && j > 0) {
		const s = sim[i - 1][j - 1];
		if (s >= MIN && score[i][j] === score[i - 1][j - 1] + s) {
			pairs.push([i - 1, j - 1]);
			i--;
			j--;
		} else if (score[i - 1][j] >= score[i][j - 1]) {
			i--;
		} else {
			j--;
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
	let i = 0;

	while (i < changes.length) {
		const change = changes[i];
		const next = changes[i + 1];

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
			for (const [d, a] of matches) pairedDel.set(d, a);
			const pairedAdd = new Set(matches.map(([, a]) => a));
			const segmentsFor = new Map<number, ReturnType<typeof pairLine>>();
			for (const [d, a] of matches) segmentsFor.set(d, pairLine(delLines[d], addLines[a]));
			for (let d = 0; d < delLines.length; d++) {
				const seg = segmentsFor.get(d);
				delRows.push({
					kind: "del",
					oldNo: oldNo++,
					text: delLines[d],
					segments: seg?.delSegments,
					paired: pairedDel.has(d),
					pairId: pairedDel.get(d),
				});
			}
			for (let a = 0; a < addLines.length; a++) {
				const d = [...pairedDel.entries()].find(([, pa]) => pa === a)?.[0];
				const seg = d === undefined ? undefined : segmentsFor.get(d);
				addRows.push({
					kind: "add",
					newNo: newNo++,
					text: addLines[a],
					segments: seg?.addSegments,
					paired: pairedAdd.has(a),
					pairId: a,
				});
			}
			rows.push(...delRows, ...addRows);
			deletions += delLines.length;
			additions += addLines.length;
			i += 2;
			continue;
		}

		if (change.removed) {
			for (const line of splitLines(change.value)) {
				rows.push({ kind: "del", oldNo: oldNo++, text: line });
				deletions++;
			}
			i++;
			continue;
		}

		if (change.added) {
			for (const line of splitLines(change.value)) {
				rows.push({ kind: "add", newNo: newNo++, text: line });
				additions++;
			}
			i++;
			continue;
		}

		for (const line of splitLines(change.value)) {
			rows.push({ kind: "context", oldNo: oldNo++, newNo: newNo++, text: line });
		}
		i++;
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
	let i = 0;

	while (i < rows.length) {
		const row = rows[i];
		if (row.kind !== "context") {
			result.push(row);
			i++;
			continue;
		}

		let j = i;
		while (j < rows.length && rows[j].kind === "context") j++;
		const run = rows.slice(i, j);
		const isLeading = i === 0;
		const isTrailing = j === rows.length;

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

		i = j;
	}

	return result;
}

export function computeDiff(before: string, after: string, context: number): DiffComputation {
	const { rows, additions, deletions } = flattenChanges(before, after);
	return { rows: groupHunks(rows, context), additions, deletions };
}

/*
 * Rendering
 * ---------
 */

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

type Block =
	{ type: "rows"; rows: DiffRow[] } | { type: "separator"; index: number; count: number };

/** Group a flattened, expansion-applied item list into runs of plain rows
 * and standalone separators, so a separator can render full-width while
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

function rowClasses(kind: DiffRowKind): { row: string; gutter: string; text: string } {
	if (kind === "add")
		return {
			row: "bg-green-500/[0.12]",
			gutter: "bg-green-500/[0.08] text-green-400",
			text: "text-gray-200",
		};
	if (kind === "del")
		return {
			row: "bg-red-500/[0.12]",
			gutter: "bg-red-500/[0.08] text-red-400",
			text: "text-gray-200",
		};
	return { row: "", gutter: "text-gray-600", text: "text-gray-300" };
}

function marker(kind: DiffRowKind): string {
	return kind === "add" ? "+" : kind === "del" ? "−" : " ";
}

function Segments({ row }: { row: DiffRow }) {
	if (row.text === "") return <>{" "}</>;
	if (!row.segments) return <>{row.text}</>;
	const highlight =
		row.kind === "add" ? "bg-green-500/35 rounded-[2px]" : "bg-red-500/35 rounded-[2px]";
	return (
		<>
			{row.segments.map((segment, index) =>
				segment.changed ? (
					<span key={index} className={highlight}>
						{segment.text}
					</span>
				) : (
					<span key={index}>{segment.text}</span>
				),
			)}
		</>
	);
}

function Separator({ count, onExpand }: { count: number; onExpand: () => void }) {
	return (
		<button
			type="button"
			onClick={onExpand}
			className="block w-full cursor-pointer bg-sky-500/5 px-4 py-1 text-left text-xs text-sky-300 hover:bg-sky-500/10"
		>
			{`↕ ${count} unchanged line${count === 1 ? "" : "s"}`}
		</button>
	);
}

function UnifiedRows({ rows }: { rows: DiffRow[] }) {
	return (
		<table className="min-w-full border-collapse text-left">
			<tbody>
				{rows.map((row, index) => {
					const { row: rowClass, gutter, text } = rowClasses(row.kind);
					return (
						<tr key={index} className={rowClass}>
							<td className={`w-1 select-none whitespace-pre px-2 text-right align-top ${gutter}`}>
								{row.oldNo ?? ""}
							</td>
							<td className={`w-1 select-none whitespace-pre px-2 text-right align-top ${gutter}`}>
								{row.newNo ?? ""}
							</td>
							<td className={`w-1 select-none whitespace-pre px-1 text-center align-top ${gutter}`}>
								{marker(row.kind)}
							</td>
							<td className={`whitespace-pre px-2 align-top ${text}`}>
								<Segments row={row} />
							</td>
						</tr>
					);
				})}
			</tbody>
		</table>
	);
}

function UnifiedView({
	rows,
	expanded,
	onExpand,
}: {
	rows: DiffHunkRow[];
	expanded: Set<number>;
	onExpand: (index: number) => void;
}) {
	const blocks = partitionBlocks(applyExpansion(rows, expanded));
	return (
		<div className="overflow-x-auto [tab-size:2]">
			{blocks.map((block, index) =>
				block.type === "separator" ? (
					<Separator key={index} count={block.count} onExpand={() => onExpand(block.index)} />
				) : (
					<UnifiedRows key={index} rows={block.rows} />
				),
			)}
		</div>
	);
}

interface SplitRow {
	left?: DiffRow;
	right?: DiffRow;
}

function toSplitRows(rows: DiffRow[]): SplitRow[] {
	const out: SplitRow[] = [];
	let i = 0;
	while (i < rows.length) {
		const row = rows[i];
		if (row.kind === "context") {
			out.push({ left: row, right: row });
			i++;
			continue;
		}
		// Collect the run of removed lines and the run of added lines that
		// follows it. Paired lines (matched by similarity) share a row; the
		// unpaired lines between them render against an empty cell, preserving
		// order on both sides.
		const dels: DiffRow[] = [];
		const adds: DiffRow[] = [];
		while (i < rows.length && rows[i].kind === "del") dels.push(rows[i++]);
		while (i < rows.length && rows[i].kind === "add") adds.push(rows[i++]);
		let a = 0;
		for (const del of dels) {
			if (del.paired && del.pairId !== undefined) {
				while (a < del.pairId) out.push({ right: adds[a++] });
				out.push({ left: del, right: adds[a++] });
			} else {
				out.push({ left: del });
			}
		}
		while (a < adds.length) out.push({ right: adds[a++] });
	}
	return out;
}

function SplitCell({ row, side }: { row?: DiffRow; side: "left" | "right" }) {
	if (!row) {
		return (
			<tr className="bg-white/[0.02]">
				<td className="select-none whitespace-pre px-2 text-right text-gray-700">{" "}</td>
				<td className="whitespace-pre px-2 text-gray-700">{" "}</td>
			</tr>
		);
	}
	const { row: rowClass, gutter, text } = rowClasses(row.kind);
	return (
		<tr className={rowClass}>
			<td className={`w-1 select-none whitespace-pre px-2 text-right align-top ${gutter}`}>
				{(side === "left" ? row.oldNo : row.newNo) ?? ""}
			</td>
			<td className={`whitespace-pre px-2 align-top ${text}`}>
				<Segments row={row} />
			</td>
		</tr>
	);
}

function SplitRows({ rows }: { rows: DiffRow[] }) {
	const splitRows = toSplitRows(rows);
	return (
		<div className="grid grid-cols-2">
			<div className="overflow-x-auto border-r border-white/5">
				<table className="min-w-full border-collapse text-left">
					<tbody>
						{splitRows.map((sr, index) => (
							<SplitCell key={index} row={sr.left} side="left" />
						))}
					</tbody>
				</table>
			</div>
			<div className="overflow-x-auto">
				<table className="min-w-full border-collapse text-left">
					<tbody>
						{splitRows.map((sr, index) => (
							<SplitCell key={index} row={sr.right} side="right" />
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function SplitView({
	rows,
	expanded,
	onExpand,
}: {
	rows: DiffHunkRow[];
	expanded: Set<number>;
	onExpand: (index: number) => void;
}) {
	const blocks = partitionBlocks(applyExpansion(rows, expanded));
	return (
		<div className="[tab-size:2]">
			{blocks.map((block, index) =>
				block.type === "separator" ? (
					<Separator key={index} count={block.count} onExpand={() => onExpand(block.index)} />
				) : (
					<SplitRows key={index} rows={block.rows} />
				),
			)}
		</div>
	);
}

export default function Diff({
	before,
	after,
	language,
	title,
	view = "unified",
	context = 3,
}: DiffProps) {
	const [activeView, setActiveView] = useState<"unified" | "split">(view);
	const [expanded, setExpanded] = useState<Set<number>>(new Set());
	const [copied, setCopied] = useState(false);
	const toggleId = useId();

	const { rows, additions, deletions } = computeDiff(before, after, context);
	const label = title ?? language ?? "diff";

	function expand(index: number) {
		setExpanded((prev) => {
			const next = new Set(prev);
			next.add(index);
			return next;
		});
	}

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(after);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// clipboard unavailable; ignore
		}
	}

	return (
		<motion.div
			initial={{ opacity: 0, y: 6 }}
			animate={{ opacity: 1, y: 0 }}
			transition={enterTransition}
			className="not-prose my-6 overflow-hidden rounded-xl bg-gray-950 shadow-md ring-1 ring-white/10"
		>
			<div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
				<div className="flex min-w-0 items-center gap-3">
					<span className="truncate text-xs font-medium text-gray-400">{label}</span>
					<span className="whitespace-nowrap font-mono text-xs">
						<span className="text-green-400">{`+${additions}`}</span>{" "}
						<span className="text-red-400">{`−${deletions}`}</span>
					</span>
				</div>
				<div className="flex items-center gap-3">
					<div role="tablist" className="inline-flex rounded-md bg-white/5 p-0.5 text-xs">
						{(["unified", "split"] as const).map((option) => (
							<button
								key={option}
								type="button"
								role="tab"
								aria-selected={activeView === option}
								onClick={() => setActiveView(option)}
								className={
									"relative cursor-pointer rounded px-2 py-0.5 capitalize transition-colors " +
									(activeView === option ? "text-white" : "text-gray-400 hover:text-white")
								}
							>
								{activeView === option ? (
									<motion.span
										layoutId={`${toggleId}-pill`}
										transition={enterTransition}
										className="absolute inset-0 rounded bg-white/10"
									/>
								) : null}
								<span className="relative">{option}</span>
							</button>
						))}
					</div>
					<button
						type="button"
						onClick={handleCopy}
						className="cursor-pointer text-xs text-gray-400 transition-colors hover:text-white"
					>
						{copied ? "Copied" : "Copy"}
					</button>
				</div>
			</div>
			<div className="font-mono text-[12.5px] leading-5">
				<CrossFade
					active={activeView}
					panes={[
						{
							key: "unified",
							node: <UnifiedView rows={rows} expanded={expanded} onExpand={expand} />,
						},
						{ key: "split", node: <SplitView rows={rows} expanded={expanded} onExpand={expand} /> },
					]}
				/>
			</div>
		</motion.div>
	);
}
