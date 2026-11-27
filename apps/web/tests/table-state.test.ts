import { describe, expect, it } from "vitest";
import { deriveTableView, normalizeTableState } from "../../client/data-table/table-state";
import { emptyState, type Column, type TableState } from "../../client/data-table/model";

const columns: Column[] = [
	{ key: "name", label: "Name", type: "text" },
	{ key: "count", label: "Count", type: "number" },
	{ key: "duration", label: "Duration", type: "time", unit: "ms" },
	{ key: "size", label: "Size", type: "bytes", unit: "B" },
];

describe("saved table state reconciliation", () => {
	it("removes deleted columns from sorting, filters, and units without reviving them when re-added", () => {
		const saved: TableState = {
			sort: { key: "removed", descending: false },
			filters: { removed: { min: "10" }, name: { pattern: "api" } },
			units: { removed: "MB" },
		};
		const normalized = normalizeTableState(saved, columns);

		expect(normalized.sort).toBeUndefined();
		expect(normalized.filters).toEqual({ name: { pattern: "api" } });
		expect(normalized.units).toEqual({});
		expect(
			normalizeTableState(normalized, [
				...columns,
				{ key: "removed", label: "Removed", type: "bytes", unit: "B" },
			]).filters,
		).not.toHaveProperty("removed");
	});

	it("migrates legacy preferences by retaining only fields supported by each current type", () => {
		const normalized = normalizeTableState(
			{
				filters: {
					name: { pattern: "api", min: "5", max: "10", unit: "MB" },
					count: { pattern: "ignored", min: "5", max: "10" },
					duration: { pattern: "ignored", min: "1", unit: "s" },
					size: { min: "2", unit: "MB" },
				},
				units: { name: "MB", count: "MB", duration: "s", size: "MB" },
			},
			columns,
		);

		expect(normalized.filters).toEqual({
			name: { pattern: "api" },
			count: { min: "5", max: "10" },
			duration: { min: "1", unit: "s" },
			size: { min: "2", unit: "MB" },
		});
		expect(normalized.units).toEqual({ duration: "s", size: "MB" });
		expect(deriveTableView(columns, [], normalized).units).toMatchObject({ name: "", count: "" });
	});

	it("discards bounds in incompatible units instead of silently changing their meaning", () => {
		const normalized = normalizeTableState(
			{
				filters: {
					count: { min: "2", unit: "MB" },
					duration: { min: "2", unit: "MB" },
					size: { min: "2", unit: "s" },
				},
				units: { count: "MB", duration: "MB", size: "s" },
			},
			columns,
		);

		expect(normalized.filters).toEqual({});
		expect(normalized.units).toEqual({});
	});

	it("resets preferences when a known column changes type while retaining a valid sort key", () => {
		const saved = normalizeTableState(
			{
				sort: { key: "count", descending: true },
				filters: { count: { min: "25" }, name: { pattern: "api" } },
				units: {},
			},
			columns,
		);
		const updated = columns.map((column): Column =>
			column.key === "count" ? { ...column, type: "percent" } : column,
		);
		const normalized = normalizeTableState(saved, updated);

		expect(normalized.filters).toEqual({ name: { pattern: "api" } });
		expect(normalized.sort).toEqual(saved.sort);
		expect(normalized.columnTypes?.count).toBe("percent");
	});

	it("preserves compatible invalid input so users can correct it", () => {
		const saved: TableState = {
			filters: {
				name: { pattern: "[" },
				count: { min: "oops" },
				duration: { min: "2", max: "1", unit: "s" },
			},
			units: { duration: "auto", size: "auto" },
		};
		const normalized = normalizeTableState(saved, columns);

		expect(normalized.filters).toEqual(saved.filters);
		expect(normalized.units).toEqual(saved.units);
		expect(Object.keys(deriveTableView(columns, [], normalized).errors)).toEqual([
			"name",
			"count",
			"duration",
		]);
	});

	it("is idempotent and leaves the supplied state untouched", () => {
		const saved = { ...emptyState(), filters: { name: { min: "1" } } };
		const normalized = normalizeTableState(saved, columns);

		expect(saved.filters.name).toEqual({ min: "1" });
		expect(normalizeTableState(normalized, columns)).toBe(normalized);
		expect(normalizeTableState(normalized, [])).toEqual({
			columnTypes: {},
			filters: {},
			units: {},
		});
	});
});
