import type { Dispatch, RefObject, SetStateAction } from "react";
import { ColumnOptions } from "./ColumnOptions";
import { ColumnMenu } from "./ColumnMenu";
import { type Column, type Row, type TableState } from "./model";
import { cycleSort, hasFilter, type ActiveCell, type VisibleRow } from "./table-state";
import { navigateTable } from "./navigation";

export interface TableHeaderCellProps {
	column: Column;
	columnIndex: number;
	rowSpan?: number;
	columnCount: number;
	data: Row[];
	rows: VisibleRow[];
	state: TableState;
	setState: Dispatch<SetStateAction<TableState>>;
	units: Record<string, string>;
	errors: Record<string, string>;
	active: ActiveCell;
	activeVisible: boolean;
	setActive: Dispatch<SetStateAction<ActiveCell>>;
	openColumn: string | null;
	setOpenColumn: Dispatch<SetStateAction<string | null>>;
	tableRef: RefObject<HTMLTableElement | null>;
}

export function TableHeaderCell({
	column,
	columnIndex,
	rowSpan = 1,
	columnCount,
	data,
	rows,
	state,
	setState,
	units,
	errors,
	active,
	activeVisible,
	setActive,
	openColumn,
	setOpenColumn,
	tableRef,
}: TableHeaderCellProps) {
	const filtered = hasFilter(state.filters[column.key]);
	const sorted = state.sort?.key === column.key;
	const selected = active?.row === -1 && active.column === columnIndex;

	return (
		<th
			key={column.key}
			scope="col"
			rowSpan={rowSpan}
			data-column={columnIndex}
			data-active={selected}
			data-numeric={column.type !== "text"}
			data-align={column.align ?? (column.type === "text" ? "left" : "right")}
			aria-sort={sorted ? (state.sort?.descending ? "descending" : "ascending") : "none"}
		>
			<ColumnMenu
				tabIndex={selected || (!activeVisible && columnIndex === 0) ? 0 : -1}
				onActivate={() => setActive({ row: -1, column: columnIndex })}
				onNavigate={(event) =>
					navigateTable(event, -1, columnIndex, rows, columnCount, tableRef.current)
				}
				onSort={() => setState((previous) => cycleSort(previous, column.key))}
				label={column.label}
				unit={units[column.key] || undefined}
				indicator={`${sorted ? (state.sort?.descending ? "↓" : "↑") : ""}${filtered ? " •" : ""}`}
				open={openColumn === column.key}
				onOpenChange={(open) =>
					setOpenColumn((previous) =>
						open ? column.key : previous === column.key ? null : previous,
					)
				}
			>
				{(close) => (
					<ColumnOptions
						column={column}
						data={data}
						state={state}
						setState={setState}
						unit={units[column.key]}
						error={errors[column.key]}
						close={close}
					/>
				)}
			</ColumnMenu>
		</th>
	);
}
