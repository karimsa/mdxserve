import { formatValue, type Column, type Row } from "./model";

/** About how wide one character of Manrope at `--size-sm` is, in points. */
const CHARACTER_WIDTH = 7.5;
/** The header's type is `--size-xs`, about this much of a body character. */
const HEADER_SCALE = 0.86;
/** A cell's padding on both sides (`px-4`). */
export const CELL_PADDING = 32;
const MIN_COLUMN_WIDTH = 72;
/** Longer text wraps inside the cell rather than widening its column further. */
const WRAP_WIDTH = 240;
/** A single word longer than this still breaks inside it, as a long word does in a narrow cell. */
const MAX_COLUMN_WIDTH = 320;

const textWidth = (characters: number) => Math.ceil(characters * CHARACTER_WIDTH) + CELL_PADDING;

/** The longest run of characters a line cannot break inside. */
function longestWord(text: string): number {
	return Math.max(0, ...text.split(/\s+/).map((word) => word.length));
}

/**
 * Each column's natural width in the app's grid, the way a table layout picks one: wide enough
 * for its header, its longest word and, up to a cap, its longest value on one line; between
 * 72 and 320 points. Estimated from the text rather than measured, so the grid is laid out once
 * and never moves after it is drawn. A value wider than its column wraps inside the cell.
 */
export function columnWidths(
	columns: readonly Column[],
	data: readonly Row[],
	units: Readonly<Record<string, string>>,
): number[] {
	return columns.map((column) => {
		const unit = units[column.key];
		// The header never wraps on the web; room for its label, unit and sort indicator.
		const header = textWidth(
			(column.label.length + (unit ? unit.length + 3 : 0) + 2) * HEADER_SCALE,
		);
		const values = data.map((row) => formatValue(row[column.key] ?? null, column, unit));
		const line = textWidth(Math.max(0, ...values.map((value) => value.length)));
		const word = textWidth(Math.max(0, ...values.map(longestWord)));
		const wanted = Math.max(header, word, Math.min(line, WRAP_WIDTH));
		return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, wanted));
	});
}

/**
 * The widths the grid draws: the natural widths when they fill `available` or more (the grid
 * then scrolls sideways), otherwise grown in proportion until they fill it exactly, as an HTML
 * table at `width: 100%` shares out its spare width.
 */
export function fitColumnWidths(widths: readonly number[], available: number): number[] {
	const total = widths.reduce((sum, width) => sum + width, 0);
	if (!(available > total) || total === 0) return [...widths];
	const grown = widths.map((width) => Math.floor((width * available) / total));
	grown[grown.length - 1] += available - grown.reduce((sum, width) => sum + width, 0);
	return grown;
}
