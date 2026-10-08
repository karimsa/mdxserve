import { useContext, useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { z } from "zod";
import { ColumnMenu } from "../data-table/ColumnMenu";
import { DocContext } from "../DocContext";
import {
	autoUnit,
	byteUnits,
	columnSchema,
	compareValues,
	emptyState,
	filterPredicate,
	formatValue,
	parseBound,
	timeUnits,
	unitFactor,
	type TableState,
	type Column,
} from "../data-table/model";

export const dataTableProps = z.object({
	id: z
		.string()
		.trim()
		.min(1)
		.describe(
			"Required stable ID, unique within this document. Retain it across edits to preserve local sorting, filters and units.",
		),
	caption: z.string().optional(),
	columns: z
		.array(columnSchema)
		.min(1)
		.describe(
			"Ordered columns: key, label, type; optional group and bars. Time/bytes require a base unit. Percent data uses fractions (0.15 displays 15%). Currency requires format(value).",
		),
	data: z.array(z.record(z.string(), z.union([z.string(), z.number().finite(), z.null()]))),
});
export type DataTableProps = z.infer<typeof dataTableProps>;
type InternalProps = DataTableProps & { renderCell?: (row: number, key: string) => ReactNode };
const savedStateSchema = z.object({
	sort: z.object({ key: z.string(), descending: z.boolean() }).optional(),
	filters: z.record(
		z.string(),
		z.object({
			pattern: z.string().optional(),
			unit: z.string().optional(),
			min: z.string().optional(),
			max: z.string().optional(),
		}),
	),
	units: z.record(z.string(), z.string()),
});
export default function DataTable(props: InternalProps) {
	const parsed = dataTableProps.parse(props);
	const keys = new Set(parsed.columns.map((column) => column.key));
	if (keys.size !== parsed.columns.length) throw new Error("DataTable column keys must be unique.");
	for (const column of parsed.columns) {
		if (column.type === "time" || column.type === "bytes") unitFactor(column.type, column.unit);
		if (
			parsed.data.some(
				(row) =>
					row[column.key] !== undefined &&
					row[column.key] !== null &&
					typeof row[column.key] !== (column.type === "text" ? "string" : "number"),
			)
		)
			throw new Error(
				`DataTable: ${column.key} requires ${column.type === "text" ? "text" : "numeric"} values.`,
			);
	}
	const context = useContext(DocContext);
	const path = context?.path ?? (typeof location === "undefined" ? "" : location.pathname);
	const storageKey = `mdxserve:table:v1:${path}:${parsed.id}`;
	return (
		<TableView key={storageKey} {...parsed} renderCell={props.renderCell} storageKey={storageKey} />
	);
}
function TableView({
	id,
	caption,
	columns,
	data,
	renderCell,
	storageKey,
}: InternalProps & { storageKey: string }) {
	const [state, setState] = useState<TableState>(emptyState);
	const [loaded, setLoaded] = useState(false);
	const [openColumn, setOpenColumn] = useState<string | null>(null);
	const [active, setActive] = useState<{ row: number; column: number } | null>(null);
	const tableRef = useRef<HTMLTableElement>(null);
	const reducedMotion = useReducedMotion();
	useEffect(() => {
		try {
			const saved = savedStateSchema.safeParse(
				JSON.parse(localStorage.getItem(storageKey) ?? "null"),
			);
			if (saved.success) setState(saved.data);
		} catch {
			/* storage is optional */
		}
		setLoaded(true);
	}, [storageKey]);
	useEffect(() => {
		if (loaded) {
			try {
				localStorage.setItem(storageKey, JSON.stringify(state));
			} catch {
				/* storage is optional */
			}
		}
	}, [state, loaded, storageKey]);
	const units = Object.fromEntries(
		columns.map((column) => {
			const options = column.type === "time" ? timeUnits : byteUnits;
			return [
				column.key,
				options.includes(state.units[column.key])
					? state.units[column.key]
					: autoUnit(
							column,
							data.map((row) => row[column.key] ?? null),
						),
			];
		}),
	);
	const errors: Record<string, string> = {};
	const predicates = columns.map((column) => {
		try {
			return {
				key: column.key,
				match: filterPredicate(
					column,
					{ ...state.filters[column.key], caseSensitive: false },
					units[column.key],
				),
			};
		} catch (error) {
			errors[column.key] = error instanceof Error ? error.message : "Invalid filter";
			return { key: column.key, match: () => true };
		}
	});
	const rows = data
		.map((row, index) => ({ row, index }))
		.filter(({ row }) => predicates.every(({ key, match }) => match(row[key] ?? null)));
	const sort = state.sort;
	if (sort && columns.some((column) => column.key === sort.key))
		rows.sort(
			(left, right) =>
				compareValues(left.row[sort.key] ?? null, right.row[sort.key] ?? null, sort.descending) ||
				left.index - right.index,
		);
	const bounds = Object.fromEntries(
		columns
			.filter((column) => column.bars)
			.map((column) => {
				const values = data
					.map((row) => row[column.key])
					.filter((value): value is number => typeof value === "number");
				return [column.key, [Math.min(0, ...values), Math.max(0, ...values)]];
			}),
	);
	const groups: { label: string; columns: Column[] }[] = [];
	for (const column of columns) {
		const label = column.group ?? "";
		const last = groups.at(-1);
		if (label && last?.label === label) last.columns.push(column);
		else groups.push({ label, columns: [column] });
	}

	const changeFilter = (key: string, patch: object) =>
		setState((previous) => ({
			...previous,
			filters: { ...previous.filters, [key]: { ...previous.filters[key], ...patch } },
		}));
	function navigate(event: KeyboardEvent<HTMLElement>, rowIndex: number, columnIndex: number) {
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
			nextColumn = columns.length - 1;
			if (event.ctrlKey || event.metaKey) nextRow = rows.length - 1;
		} else return;
		event.preventDefault();
		nextRow = Math.max(-1, Math.min(rows.length - 1, nextRow));
		nextColumn = Math.max(0, Math.min(columns.length - 1, nextColumn));
		const target =
			nextRow === -1
				? `thead th[data-column="${nextColumn}"] .data-table-heading`
				: `tbody [data-row="${rows[nextRow]?.index}"][data-column="${nextColumn}"]`;
		tableRef.current?.querySelector<HTMLElement>(target)?.focus();
	}
	const activeVisible =
		active &&
		(active.row === -1 || rows.some(({ index }) => index === active.row)) &&
		active.column < columns.length;
	const filteredColumns = columns.filter((column) =>
		Object.entries(state.filters[column.key] ?? {}).some(
			([key, value]) => key !== "unit" && typeof value === "string" && value !== "",
		),
	);
	function clearFilter(key: string) {
		setState((previous) => ({ ...previous, filters: { ...previous.filters, [key]: {} } }));
	}
	function changeUnit(column: Column, selected: string) {
		if (column.type !== "time" && column.type !== "bytes") return;
		const nextUnit =
			selected === "auto"
				? autoUnit(
						column,
						data.map((row) => row[column.key] ?? null),
					)
				: selected;
		const nextFilter = { ...state.filters[column.key] };
		for (const bound of ["min", "max"] as const) {
			try {
				const value = parseBound(
					nextFilter[bound] ?? "",
					column,
					nextFilter.unit ?? units[column.key],
				);
				if (value !== undefined)
					nextFilter[bound] = String(
						(value * unitFactor(column.type, column.unit)) / unitFactor(column.type, nextUnit),
					);
			} catch {
				/* retain invalid input for correction */
			}
		}
		nextFilter.unit = nextUnit;
		setState((previous) => ({
			...previous,
			units: { ...previous.units, [column.key]: selected },
			filters: { ...previous.filters, [column.key]: nextFilter },
		}));
	}
	function header(column: Column, rowSpan = 1) {
		const filtered = filteredColumns.some((item) => item.key === column.key);
		const sorted = state.sort?.key === column.key;
		const columnIndex = columns.findIndex((item) => item.key === column.key);
		const selected = active?.row === -1 && active.column === columnIndex;
		return (
			<th
				key={column.key}
				scope="col"
				rowSpan={rowSpan}
				data-column={columnIndex}
				data-active={selected}
				data-numeric={column.type !== "text"}
				aria-sort={sorted ? (state.sort?.descending ? "descending" : "ascending") : "none"}
			>
				<ColumnMenu
					tabIndex={selected || (!activeVisible && columnIndex === 0) ? 0 : -1}
					onActivate={() => setActive({ row: -1, column: columnIndex })}
					onNavigate={(event) => navigate(event, -1, columnIndex)}
					onSort={() =>
						setState((previous) => ({
							...previous,
							sort:
								previous.sort?.key !== column.key
									? { key: column.key, descending: false }
									: previous.sort.descending
										? undefined
										: { key: column.key, descending: true },
						}))
					}
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
						<>
							<div className="data-table-menu-sorting">
								{[false, true].map((descending) => (
									<button
										key={String(descending)}
										type="button"
										aria-label={descending ? "Sort descending" : "Sort ascending"}
										title={descending ? "Sort descending" : "Sort ascending"}
										aria-pressed={sorted && state.sort?.descending === descending}
										onClick={() => {
											setState((previous) => ({
												...previous,
												sort: { key: column.key, descending },
											}));
											close();
										}}
									>
										<span aria-hidden="true">{descending ? "↓" : "↑"}</span>
									</button>
								))}
							</div>
							<div className="data-table-menu-filter">
								{column.type === "text" ? (
									<>
										<label>
											Matches regular expression
											<input
												aria-label={`Filter ${column.label} by regular expression`}
												placeholder="e.g. search|api"
												value={state.filters[column.key]?.pattern ?? ""}
												onChange={(event) =>
													changeFilter(column.key, { pattern: event.target.value })
												}
											/>
										</label>
									</>
								) : (
									<div className="data-table-range">
										{["min", "max"].map((bound) => (
											<label key={bound}>
												{bound === "min" ? "Minimum" : "Maximum"}
												{column.type === "percent"
													? " (%)"
													: units[column.key]
														? ` (${state.filters[column.key]?.unit ?? units[column.key]})`
														: ""}
												<input
													aria-label={`${column.label} ${bound}`}
													placeholder="Any"
													value={state.filters[column.key]?.[bound as "min" | "max"] ?? ""}
													onChange={(event) =>
														changeFilter(column.key, {
															[bound]: event.target.value,
															unit: state.filters[column.key]?.unit ?? units[column.key],
														})
													}
												/>
											</label>
										))}
									</div>
								)}
								{errors[column.key] && (
									<div className="data-table-error" role="alert">
										{errors[column.key]}
									</div>
								)}
							</div>
							{(column.type === "time" || column.type === "bytes") && (
								<label className="data-table-menu-unit">
									Display unit
									<select
										aria-label={`${column.label} display unit`}
										value={state.units[column.key] ?? "auto"}
										onChange={(event) => changeUnit(column, event.target.value)}
									>
										<option value="auto">
											Auto (
											{autoUnit(
												column,
												data.map((row) => row[column.key] ?? null),
											)}
											)
										</option>
										{(column.type === "time" ? timeUnits : byteUnits).map((unit) => (
											<option key={unit}>{unit}</option>
										))}
									</select>
								</label>
							)}
							{(filtered || sorted) && (
								<button
									type="button"
									className="data-table-clear"
									onClick={() => {
										clearFilter(column.key);
										if (sorted) setState((previous) => ({ ...previous, sort: undefined }));
										close();
									}}
								>
									Clear sort and filter
								</button>
							)}
						</>
					)}
				</ColumnMenu>
			</th>
		);
	}

	return (
		<div className="data-table not-prose" data-table-id={id}>
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
							onClick={() => clearFilter(column.key)}
						>
							{column.label}:{" "}
							{column.type === "text"
								? state.filters[column.key]?.pattern
								: `${state.filters[column.key]?.min || "Any"} – ${state.filters[column.key]?.max || "Any"}${column.type === "percent" ? "%" : state.filters[column.key]?.unit ? ` ${state.filters[column.key].unit}` : ""}`}{" "}
							<span aria-hidden="true">×</span>
						</button>
					))}
				</div>
			)}

			<div className="data-table-scroll">
				<table ref={tableRef} aria-label={caption ?? "Data table"}>
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
											header(group.columns[0], 2)
										),
									)}
								</tr>
								<tr>
									{groups
										.filter((group) => group.label)
										.flatMap((group) => group.columns.map((column) => header(column)))}
								</tr>
							</>
						) : (
							<tr>{columns.map((column) => header(column))}</tr>
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
									{columns.map((column, columnIndex) => {
										const value = row[column.key] ?? null;
										const limits = bounds[column.key];
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
												onKeyDown={(event) => navigate(event, rowIndex, columnIndex)}
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
													{renderCell?.(index, column.key) ??
														formatValue(value, column, units[column.key])}
												</span>
											</td>
										);
									})}
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
