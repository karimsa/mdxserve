import type { Dispatch, SetStateAction } from "react";
import { autoUnit, byteUnits, timeUnits, type Column, type Row, type TableState } from "./model";
import { changeUnit, clearFilter, hasFilter, updateFilter } from "./table-state";

interface ColumnOptionsProps {
	column: Column;
	data: Row[];
	state: TableState;
	setState: Dispatch<SetStateAction<TableState>>;
	unit: string;
	error?: string;
	close: () => void;
}

export function ColumnOptions({
	column,
	data,
	state,
	setState,
	unit,
	error,
	close,
}: ColumnOptionsProps) {
	const sorted = state.sort?.key === column.key;
	const filtered = hasFilter(state.filters[column.key]);

	return (
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
									setState((previous) =>
										updateFilter(previous, column.key, { pattern: event.target.value }),
									)
								}
							/>
						</label>
					</>
				) : (
					<div className="data-table-range">
						{(["min", "max"] as const).map((bound) => (
							<label key={bound}>
								{bound === "min" ? "Minimum" : "Maximum"}
								{column.type === "percent"
									? " (%)"
									: unit
										? ` (${state.filters[column.key]?.unit ?? unit})`
										: ""}
								<input
									aria-label={`${column.label} ${bound}`}
									placeholder="Any"
									value={state.filters[column.key]?.[bound] ?? ""}
									onChange={(event) =>
										setState((previous) =>
											updateFilter(previous, column.key, {
												[bound]: event.target.value,
												unit: state.filters[column.key]?.unit ?? unit,
											}),
										)
									}
								/>
							</label>
						))}
					</div>
				)}
				{error && (
					<div className="data-table-error" role="alert">
						{error}
					</div>
				)}
			</div>

			{(column.type === "time" || column.type === "bytes") && (
				<label className="data-table-menu-unit">
					Display unit
					<select
						aria-label={`${column.label} display unit`}
						value={state.units[column.key] ?? "auto"}
						onChange={(event) =>
							setState((previous) => changeUnit(previous, column, event.target.value, data, unit))
						}
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
						setState((previous) => clearFilter(previous, column.key));
						if (sorted) setState((previous) => ({ ...previous, sort: undefined }));
						close();
					}}
				>
					Clear sort and filter
				</button>
			)}
		</>
	);
}
