import ms from "ms";
import bytes from "bytes";
import { z } from "zod";

const common = {
	key: z.string().min(1),
	label: z.string().min(1),
	group: z.string().optional(),
	bars: z
		.boolean()
		.optional()
		.describe("Opt-in magnitude bars; zero is always included in the scale."),
};
const formatter = z.custom<(value: number) => string>((value) => typeof value === "function");
export const columnSchema = z.discriminatedUnion("type", [
	z.object({ ...common, type: z.literal("text") }),
	z.object({ ...common, type: z.literal("number") }),
	z.object({ ...common, type: z.literal("percent") }),
	z.object({ ...common, type: z.literal("time"), unit: z.string().min(1) }),
	z.object({ ...common, type: z.literal("bytes"), unit: z.string().min(1) }),
	z.object({
		...common,
		type: z.literal("currency"),
		format: formatter.describe(
			"Required numeric-to-string currency formatter, e.g. value => `$${value}`",
		),
	}),
]);
export type Column = z.infer<typeof columnSchema>;
export type Value = string | number | null;
export type Row = Record<string, Value>;
export type Filter = {
	pattern?: string;
	caseSensitive?: boolean;
	min?: string;
	max?: string;
	unit?: string;
};
export type TableState = {
	sort?: { key: string; descending: boolean };
	filters: Record<string, Filter>;
	units: Record<string, string>;
};
export const emptyState = (): TableState => ({ filters: {}, units: {} });
export const timeUnits = ["ms", "s", "m", "h", "d", "w", "y"];
export const byteUnits = ["B", "KB", "MB", "GB", "TB", "PB"];
export function unitFactor(type: "time" | "bytes", unit: string): number {
	try {
		if (type === "bytes" && !/^(b|kb|mb|gb|tb|pb)$/i.test(unit))
			throw new Error("Invalid bytes unit");
		const result = type === "time" ? ms(`1 ${unit}` as ms.StringValue) : bytes.parse(`1${unit}`);
		if (typeof result === "number" && Number.isFinite(result) && result > 0) return result;
	} catch {
		/* invalid unit is reported by the component */
	}
	throw new Error(`Unsupported ${type} unit: ${unit}`);
}
export function parseBound(
	input: string,
	column: Column,
	displayUnit?: string,
): number | undefined {
	if (!input.trim()) return undefined;
	const raw = input.trim();
	const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
	let result: number | null | undefined;
	if (column.type === "time" || column.type === "bytes") {
		const base = unitFactor(column.type, column.unit);
		if (numeric.test(raw))
			result = (Number(raw) * unitFactor(column.type, displayUnit ?? column.unit)) / base;
		else {
			try {
				result = column.type === "time" ? ms(raw as ms.StringValue) : bytes.parse(raw);
			} catch {
				result = undefined;
			}
			// bytes.parse accepts arbitrary trailing text; require a complete supported unit.
			if (
				column.type === "bytes" &&
				!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*(?:b|kb|mb|gb|tb|pb)$/i.test(raw)
			)
				result = undefined;
			if (typeof result === "number") result /= base;
		}
	} else if (column.type === "percent") {
		const percentage = raw.replace(/%$/, "").trim();
		if (numeric.test(percentage)) result = Number(percentage) / 100;
	} else if (column.type === "currency") {
		const match = raw.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([kmbt])?$/i);
		if (match)
			result =
				Number(match[1]) * ({ k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[match[2]?.toLowerCase()] ?? 1);
	} else if (numeric.test(raw)) result = Number(raw);
	if (typeof result !== "number" || !Number.isFinite(result))
		throw new Error("Enter a valid number or supported unit.");
	return result;
}
export function autoUnit(column: Column, values: Value[]): string {
	if (column.type !== "time" && column.type !== "bytes") return "";
	const magnitude = Math.max(
		0,
		...values
			.filter((value): value is number => typeof value === "number")
			.map((value) => Math.abs(value) * unitFactor(column.type as "time" | "bytes", column.unit)),
	);
	const units = column.type === "time" ? timeUnits : byteUnits;
	return (
		[...units]
			.reverse()
			.find((unit) => magnitude >= unitFactor(column.type as "time" | "bytes", unit)) ?? units[0]
	);
}
export function formatValue(value: Value, column: Column, unit?: string): string {
	if (value === null) return "—";
	if (typeof value !== "number") return value;
	const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 });
	if (column.type === "percent")
		return `${new Intl.NumberFormat("en-US", { maximumSignificantDigits: 12 }).format(value * 100)}%`;
	if (column.type === "currency") return column.format(value);
	if (column.type === "time" || column.type === "bytes") {
		const chosen = unit ?? column.unit;
		return `${new Intl.NumberFormat("en-US", { maximumSignificantDigits: 6 }).format((value * unitFactor(column.type, column.unit)) / unitFactor(column.type, chosen))} ${chosen}`;
	}
	return numberFormat.format(value);
}
export function filterPredicate(
	column: Column,
	filter: Filter,
	unit?: string,
): (value: Value) => boolean {
	if (column.type === "text") {
		const regexp = new RegExp(filter.pattern ?? "", filter.caseSensitive ? "" : "i");
		return (value) => regexp.test(String(value ?? ""));
	}
	const min = parseBound(filter.min ?? "", column, filter.unit ?? unit);
	const max = parseBound(filter.max ?? "", column, filter.unit ?? unit);
	if (min !== undefined && max !== undefined && min > max)
		throw new Error("Minimum must not exceed maximum.");
	return (value) =>
		(min === undefined && max === undefined) ||
		(typeof value === "number" &&
			(min === undefined || value >= min) &&
			(max === undefined || value <= max));
}
export function compareValues(left: Value, right: Value, descending: boolean): number {
	if (left === null) return right === null ? 0 : 1;
	if (right === null) return -1;
	const order =
		typeof left === "number" && typeof right === "number"
			? left - right
			: String(left).localeCompare(String(right), undefined, { numeric: true });
	return descending ? -order : order;
}

/** Infer only when every nonmissing cell agrees; never infer bars from numeric data. */
export function inferColumn(key: string, label: string, values: string[]): Column {
	const present = values
		.map((value) => value.trim())
		.filter((value) => value !== "" && value !== "—");
	const base = { key, label };
	const numeric = /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/;
	if (present.length && present.every((value) => numeric.test(value)))
		return { ...base, type: "number" };
	if (
		present.length &&
		present.every((value) => value.endsWith("%") && numeric.test(value.slice(0, -1)))
	)
		return { ...base, type: "percent" };
	const size: Column = { ...base, type: "bytes", unit: "B" };
	if (
		present.length &&
		present.every((value) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*(b|kb|mb|gb|tb|pb)$/i.test(value))
	)
		return size;
	const duration: Column = { ...base, type: "time", unit: "ms" };
	if (
		present.length &&
		present.every((value) => {
			if (!/[a-z]/i.test(value)) return false;
			try {
				return parseBound(value, duration) !== undefined;
			} catch {
				return false;
			}
		})
	)
		return duration;
	return { ...base, type: "text" };
}
