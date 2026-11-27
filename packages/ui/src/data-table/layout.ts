import { formatValue, type Column, type Row } from "./model";

/** About how wide one character of Manrope at `--size-sm` is, in points. */
const CHARACTER_WIDTH = 7.5;
/** A cell's padding on both sides (`px-4`). */
const CELL_PADDING = 32;
const MIN_COLUMN_WIDTH = 72;
/** Longer text wraps inside the cell rather than widening its column further. */
const MAX_COLUMN_WIDTH = 240;

/**
 * Each column's width in the app's grid, from its longest formatted value or header. A grid of
 * views has no table layout to size its columns, and measuring every cell would draw the table
 * twice. The columns grow from these widths when the table is narrower than the screen.
 */
export function columnWidths(
	columns: readonly Column[],
	data: readonly Row[],
	units: Readonly<Record<string, string>>,
): number[] {
	return columns.map((column) => {
		const unit = units[column.key];
		// The header is smaller type, with room for its unit and its sort indicator.
		const header = (column.label.length + (unit ? unit.length + 3 : 0) + 2) * 0.86;
		const longest = Math.max(
			header,
			...data.map((row) => formatValue(row[column.key] ?? null, column, unit).length),
		);
		return Math.min(
			MAX_COLUMN_WIDTH,
			Math.max(MIN_COLUMN_WIDTH, Math.ceil(longest * CHARACTER_WIDTH) + CELL_PADDING),
		);
	});
}
