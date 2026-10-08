import type { KeyboardEvent } from "react";
import type { VisibleRow } from "./table-state";

export function navigateTable(
	event: KeyboardEvent<HTMLElement>,
	rowIndex: number,
	columnIndex: number,
	rows: VisibleRow[],
	columnCount: number,
	table: HTMLTableElement | null,
) {
	if (event.target !== event.currentTarget) return;
	let nextRow = rowIndex;
	let nextColumn = columnIndex;
	if (event.key === "ArrowDown") nextRow++;
	else if (event.key === "ArrowUp") nextRow--;
	else if (event.key === "ArrowLeft") nextColumn--;
	else if (event.key === "ArrowRight") nextColumn++;
	else if (event.key === "Home") {
		nextColumn = 0;
		if (event.ctrlKey || event.metaKey) nextRow = -1;
	} else if (event.key === "End") {
		nextColumn = columnCount - 1;
		if (event.ctrlKey || event.metaKey) nextRow = rows.length - 1;
	} else return;
	event.preventDefault();
	nextRow = Math.max(-1, Math.min(rows.length - 1, nextRow));
	nextColumn = Math.max(0, Math.min(columnCount - 1, nextColumn));
	const target =
		nextRow === -1
			? `thead th[data-column="${nextColumn}"] .data-table-heading`
			: `tbody [data-row="${rows[nextRow]?.index}"][data-column="${nextColumn}"]`;
	table?.querySelector<HTMLElement>(target)?.focus();
}
