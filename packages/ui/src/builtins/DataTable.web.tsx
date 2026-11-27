import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { TableHeaderCell } from "../data-table/TableHeaderCell.web";
import { useTableState } from "../data-table/useTableState";
import {
	clearFilter,
	deriveTableView,
	hasFilter,
	filterSummary,
	type ActiveCell,
} from "../data-table/table-state";
import { TableCell } from "../data-table/TableCell.web";
import { useDocumentBlockScope } from "../block-state/useBlockState";
import { blockStateKey, type BlockStateScope } from "../block-state/storage";
import { validateTableProps, type DataTableViewProps } from "../data-table/props";

/**
 * The web's `DataTable`: a real `<table>`, so it keeps its semantics, copies as a table and
 * anchors comments in its cells. Column menus, keyboard movement between cells and the row
 * animations are the web's own; the state, sorting and filtering are shared with the app's
 * grid (DataTable.tsx).
 */
export default function DataTable(props: DataTableViewProps) {
	const parsed = validateTableProps(props);

	const scope = useDocumentBlockScope({ kind: "table", version: 1, blockId: parsed.id });

	return (
		<TableView
			key={blockStateKey(scope)}
			{...parsed}
			renderCell={props.renderCell}
			renderHeader={props.renderHeader}
			tableProps={props.tableProps}
			persistState={props.persistState}
			portal={props.portal}
			scope={scope}
		/>
	);
}

function TableView({
	id,
	caption,
	columns,
	data,
	renderCell,
	renderHeader,
	tableProps,
	persistState = true,
	portal,
	scope,
}: DataTableViewProps & { scope: BlockStateScope }) {
	const [state, setState] = useTableState(scope, columns, persistState);
	const [openColumn, setOpenColumn] = useState<string | null>(null);
	const [active, setActive] = useState<ActiveCell>(null);
	const tableRef = useRef<HTMLTableElement>(null);
	const reducedMotion = useReducedMotion();

	const { units, errors, rows, bounds, groups } = deriveTableView(columns, data, state);
	const activeVisible =
		active &&
		(active.row === -1 || rows.some(({ index }) => index === active.row)) &&
		active.column < columns.length;
	const filteredColumns = columns.filter((column) => hasFilter(state.filters[column.key]));

	const headerProps = {
		renderHeader,
		columnCount: columns.length,
		data,
		rows,
		state,
		setState,
		units,
		errors,
		active,
		activeVisible: Boolean(activeVisible),
		setActive,
		openColumn,
		setOpenColumn,
		tableRef,
		portal,
	};

	return (
		<div className="data-table not-prose" data-table-id={id} data-table-persist={persistState}>
			<div className="data-table-toolbar">
				<span>{caption ?? "Table"}</span>
				<span className="data-table-count">{data.length} rows</span>
			</div>
			{(state.sort || filteredColumns.length > 0) && (
				<div className="data-table-chips">
					{state.sort && (
						<button
							type="button"
							aria-label="Clear sorting"
							onClick={() => setState((previous) => ({ ...previous, sort: undefined }))}
						>
							{columns.find((column) => column.key === state.sort?.key)?.label}{" "}
							{state.sort.descending ? "↓" : "↑"} <span aria-hidden="true">×</span>
						</button>
					)}
					{filteredColumns.map((column) => (
						<button
							type="button"
							key={column.key}
							aria-label={`Clear ${column.label} filter`}
							onClick={() => setState((previous) => clearFilter(previous, column.key))}
						>
							{column.label}: {filterSummary(column, state.filters[column.key])}{" "}
							<span aria-hidden="true">×</span>
						</button>
					))}
				</div>
			)}

			<div className="data-table-scroll">
				<table aria-label={caption ?? "Data table"} {...tableProps} ref={tableRef}>
					<thead>
						{columns.some((column) => column.group) ? (
							<>
								<tr className="data-table-groups">
									{groups.map((group) =>
										group.label ? (
											<th
												key={group.columns[0].key}
												colSpan={group.columns.length}
												scope="colgroup"
											>
												{group.label}
											</th>
										) : (
											<TableHeaderCell
												key={group.columns[0].key}
												{...headerProps}
												column={group.columns[0]}
												columnIndex={columns.indexOf(group.columns[0])}
												rowSpan={2}
											/>
										),
									)}
								</tr>
								<tr>
									{groups
										.filter((group) => group.label)
										.flatMap((group) =>
											group.columns.map((column) => (
												<TableHeaderCell
													key={column.key}
													{...headerProps}
													column={column}
													columnIndex={columns.indexOf(column)}
												/>
											)),
										)}
								</tr>
							</>
						) : (
							<tr>
								{columns.map((column) => (
									<TableHeaderCell
										key={column.key}
										{...headerProps}
										column={column}
										columnIndex={columns.indexOf(column)}
									/>
								))}
							</tr>
						)}
					</thead>
					<tbody>
						<AnimatePresence initial={false}>
							{rows.map(({ row, index }, rowIndex) => (
								<motion.tr
									key={index}
									layout={!reducedMotion}
									initial={reducedMotion ? false : { opacity: 0 }}
									animate={{ opacity: 1 }}
									exit={{ opacity: 0 }}
									transition={{ duration: reducedMotion ? 0 : 0.18 }}
								>
									{columns.map((column, columnIndex) => (
										<TableCell
											key={column.key}
											column={column}
											columnIndex={columnIndex}
											columnCount={columns.length}
											row={row}
											index={index}
											rowIndex={rowIndex}
											rows={rows}
											unit={units[column.key]}
											limits={bounds[column.key]}
											active={active}
											setActive={setActive}
											tableRef={tableRef}
											renderCell={renderCell}
										/>
									))}
								</motion.tr>
							))}
						</AnimatePresence>
						{rows.length === 0 && (
							<tr>
								<td colSpan={columns.length}>No matching rows. Adjust or reset filters.</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
			<div className="data-table-note">
				<span aria-live="polite">
					{rows.length} of {data.length} rows
				</span>
				{columns.some((column) => column.bars) && <span>Lines compare within each column</span>}
			</div>
			{Object.keys(errors).length > 0 && (
				<div role="alert" className="data-table-error">
					Invalid filter:{" "}
					{columns
						.filter((column) => errors[column.key])
						.map((column) => column.label)
						.join(", ")}
					. Open its column menu to correct it.
				</div>
			)}
		</div>
	);
}
