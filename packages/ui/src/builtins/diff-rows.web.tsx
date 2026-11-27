import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
	marker,
	rowClasses,
	toSplitRows,
	visibleBlocks,
	type DiffHunkRow,
	type DiffRow,
} from "./diff-model";

/*
 * The web's diff rows: real tables, so the line numbers size to their column and copying a
 * selection copies lines, as before the move. The app's are diff-rows.tsx.
 */

/** Word-level highlight: one step stronger than the row tint it sits on. */
function highlightStyle(kind: "add" | "del"): { backgroundColor: string } {
	const fgVar = kind === "add" ? "var(--status-ok-fg)" : "var(--status-danger-fg)";
	return { backgroundColor: `color-mix(in oklab, ${fgVar} 35%, transparent)` };
}

function Segments({ row }: { row: DiffRow }) {
	if (row.text === "") return <>{" "}</>;
	if (!row.segments) return <>{row.text}</>;
	const style = row.kind === "add" || row.kind === "del" ? highlightStyle(row.kind) : undefined;
	return (
		<>
			{row.segments.map((segment, index) =>
				segment.changed ? (
					<span key={index} className="rounded-[2px]" style={style}>
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
			className="block w-full cursor-pointer bg-surface-accent-soft px-4 py-1 text-left text-xs text-text-accent hover:brightness-95"
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

export function UnifiedView({
	rows,
	expanded,
	onExpand,
}: {
	rows: DiffHunkRow[];
	expanded: Set<number>;
	onExpand: (index: number) => void;
}) {
	const blocks = visibleBlocks(rows, expanded);
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

function SplitCell({ row, side }: { row?: DiffRow; side: "left" | "right" }) {
	if (!row) {
		return (
			<tr className="bg-surface-sunken">
				<td className="select-none whitespace-pre px-2 text-right text-code-gutter">{" "}</td>
				<td className="whitespace-pre px-2 text-code-gutter">{" "}</td>
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
			<div className="overflow-x-auto border-r border-code-border">
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

export function SplitView({
	rows,
	expanded,
	onExpand,
}: {
	rows: DiffHunkRow[];
	expanded: Set<number>;
	onExpand: (index: number) => void;
}) {
	const blocks = visibleBlocks(rows, expanded);
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

/**
 * Both views stacked in one grid cell, the inactive one faded out and inert, with the height
 * following the active one: switching never collapses the layout (the web client's
 * `CrossFade`, with CSS transitions instead of framer-motion).
 */
export function DiffPanes({
	active,
	unified,
	split,
}: {
	active: "unified" | "split";
	unified: ReactNode;
	split: ReactNode;
}) {
	const panes = useRef(new Map<string, HTMLDivElement>());
	const [height, setHeight] = useState<number | null>(null);

	useLayoutEffect(() => {
		const pane = panes.current.get(active);
		if (!pane) return;
		const measure = () => setHeight(pane.offsetHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(pane);
		return () => observer.disconnect();
	}, [active]);

	return (
		<div
			className="grid grid-cols-[minmax(0,1fr)] overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
			style={height === null ? undefined : { height }}
		>
			{(
				[
					["unified", unified],
					["split", split],
				] as const
			).map(([key, node]) => {
				const isActive = key === active;
				return (
					<div
						key={key}
						ref={(element) => {
							if (element) panes.current.set(key, element);
							else panes.current.delete(key);
						}}
						className="min-w-0 [grid-area:1/1] self-start transition-opacity duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
						style={{ opacity: isActive ? 1 : 0, pointerEvents: isActive ? "auto" : "none" }}
						inert={!isActive}
						aria-hidden={!isActive}
					>
						{node}
					</div>
				);
			})}
		</div>
	);
}
