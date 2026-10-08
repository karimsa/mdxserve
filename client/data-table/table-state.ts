import {
	autoUnit,
	byteUnits,
	compareValues,
	filterPredicate,
	parseBound,
	timeUnits,
	unitFactor,
	type Column,
	type Filter,
	type Row,
	type TableState,
} from "./model";

export type ActiveCell = { row: number; column: number } | null;
export type VisibleRow = { row: Row; index: number };

function normalizeFilter(filter: Filter, column: Column): Filter {
	if (column.type === "text") {
		return filter.pattern === undefined ? {} : { pattern: filter.pattern };
	}

	const options = column.type === "time" ? timeUnits : column.type === "bytes" ? byteUnits : [];
	// A bound recorded in a different measurement must not be silently reinterpreted.
	if (filter.unit && !options.includes(filter.unit)) return {};

	return {
		...(filter.min === undefined ? {} : { min: filter.min }),
		...(filter.max === undefined ? {} : { max: filter.max }),
		...(filter.unit && options.includes(filter.unit) ? { unit: filter.unit } : {}),
	};
}

/** Reconcile persisted preferences before they reach sorting, filters, or labels. */
export function normalizeTableState(state: TableState, columns: Column[]): TableState {
	const columnTypes = Object.fromEntries(columns.map((column) => [column.key, column.type]));
	const normalized: TableState = { columnTypes, filters: {}, units: {} };

	if (state.sort && columns.some((column) => column.key === state.sort?.key)) {
		normalized.sort = state.sort;
	}

	for (const column of columns) {
		const previousType = state.columnTypes?.[column.key];
		if (previousType && previousType !== column.type) continue;

		const filter = state.filters[column.key];
		if (filter) {
			const compatible = normalizeFilter(filter, column);
			if (Object.keys(compatible).length) normalized.filters[column.key] = compatible;
		}

		const options = column.type === "time" ? timeUnits : column.type === "bytes" ? byteUnits : [];
		const unit = state.units[column.key];
		if (options.length && (unit === "auto" || options.includes(unit))) {
			normalized.units[column.key] = unit;
		}
	}

	// Keep the same reference when already normalized so persistence does not cause render loops.
	return JSON.stringify(normalized) === JSON.stringify(state) ? state : normalized;
}

export function deriveTableView(columns: Column[], data: Row[], state: TableState) {
	const units = Object.fromEntries(
		columns.map((column) => {
			const options = column.type === "time" ? timeUnits : column.type === "bytes" ? byteUnits : [];
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

	return { units, errors, rows, bounds, groups };
}

export function updateFilter(state: TableState, key: string, patch: Partial<Filter>): TableState {
	return { ...state, filters: { ...state.filters, [key]: { ...state.filters[key], ...patch } } };
}

export function clearFilter(state: TableState, key: string): TableState {
	return { ...state, filters: { ...state.filters, [key]: {} } };
}

export function cycleSort(state: TableState, key: string): TableState {
	const sort =
		state.sort?.key !== key
			? { key, descending: false }
			: state.sort.descending
				? undefined
				: { key, descending: true };

	return { ...state, sort };
}

export function hasFilter(filter: Filter = {}): boolean {
	return Object.entries(filter).some(
		([key, value]) => key !== "unit" && typeof value === "string" && value !== "",
	);
}

export function changeUnit(
	state: TableState,
	column: Column,
	selected: string,
	data: Row[],
	displayUnit: string,
): TableState {
	if (column.type !== "time" && column.type !== "bytes") return state;
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
			const value = parseBound(nextFilter[bound] ?? "", column, nextFilter.unit ?? displayUnit);
			if (value !== undefined)
				nextFilter[bound] = String(
					(value * unitFactor(column.type, column.unit)) / unitFactor(column.type, nextUnit),
				);
		} catch {
			/* retain invalid input for correction */
		}
	}
	nextFilter.unit = nextUnit;
	return {
		...state,
		units: { ...state.units, [column.key]: selected },
		filters: { ...state.filters, [column.key]: nextFilter },
	};
}

export function filterSummary(column: Column, filter: Filter = {}): string {
	if (column.type === "text") return filter.pattern ?? "";

	const unit = column.type === "percent" ? "%" : filter.unit ? ` ${filter.unit}` : "";
	return `${filter.min || "Any"} – ${filter.max || "Any"}${unit}`;
}
