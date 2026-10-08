import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import { formatValue, type Column, type Row } from "./model";
import { navigateTable } from "./navigation";
import type { ActiveCell, VisibleRow } from "./table-state";

interface TableCellProps {
	column: Column;
	columnIndex: number;
	columnCount: number;
	row: Row;
	index: number;
	rowIndex: number;
	rows: VisibleRow[];
	unit: string;
	limits?: number[];
	active: ActiveCell;
	setActive: Dispatch<SetStateAction<ActiveCell>>;
	tableRef: RefObject<HTMLTableElement | null>;
	renderCell?: (row: number, key: string) => ReactNode;
}

export function TableCell({
	column,
	columnIndex,
	columnCount,
	row,
	index,
	rowIndex,
	rows,
	unit,
	limits,
	active,
	setActive,
	tableRef,
	renderCell,
}: TableCellProps) {
	const value = row[column.key] ?? null;
	const span = limits ? limits[1] - limits[0] : 0;
	const selected = active?.row === index && active.column === columnIndex;

	return (
		<td
			key={column.key}
			data-row={index}
			data-column={columnIndex}
			data-numeric={column.type !== "text"}
			data-active={selected}
			data-bars={Boolean(limits)}
			tabIndex={selected ? 0 : -1}
			onFocus={() => setActive({ row: index, column: columnIndex })}
			onClick={(event) => {
				setActive({ row: index, column: columnIndex });
				if (!(event.target as HTMLElement).closest("a,button,input,select"))
					event.currentTarget.focus();
			}}
			onKeyDown={(event) =>
				navigateTable(event, rowIndex, columnIndex, rows, columnCount, tableRef.current)
			}
		>
			{limits && typeof value === "number" && span > 0 && (
				<span
					className="data-table-bar"
					aria-hidden="true"
					style={{
						left: `calc(16px + (100% - 32px) * ${(Math.min(0, value) - limits[0]) / span})`,
						width: `calc((100% - 32px) * ${Math.abs(value) / span})`,
					}}
				/>
			)}
			<span className="data-table-value">
				{renderCell?.(index, column.key) ?? formatValue(value, column, unit)}
			</span>
		</td>
	);
}
