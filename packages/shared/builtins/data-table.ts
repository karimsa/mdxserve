import { z } from "zod";

const common = {
	key: z.string().min(1),
	label: z.string().min(1),
	group: z.string().optional(),
	align: z
		.enum(["left", "center", "right"])
		.optional()
		.describe("Explicit alignment overrides the column type default."),
	bars: z
		.boolean()
		.optional()
		.describe("Opt-in magnitude bars; zero is always included in the scale."),
};
export const columnSchema = z.discriminatedUnion("type", [
	z.object({ ...common, type: z.literal("text") }),
	z.object({ ...common, type: z.literal("number") }),
	z.object({ ...common, type: z.literal("percent") }),
	z.object({ ...common, type: z.literal("time"), unit: z.string().min(1) }),
	z.object({ ...common, type: z.literal("bytes"), unit: z.string().min(1) }),
	z.object({
		...common,
		type: z.literal("currency"),
		currency: z
			.string()
			.regex(/^[A-Z]{3}$/, "Use an uppercase ISO 4217 currency code, e.g. USD")
			.describe("Required ISO 4217 currency code, e.g. USD or EUR."),
	}),
]);

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
			"Ordered columns: key, label, type; optional group and bars. Time/bytes require a base unit. Percent data uses fractions (0.15 displays 15%). Currency requires a currency code such as USD and formats values as money.",
		),
	data: z.array(z.record(z.string(), z.union([z.string(), z.number().finite(), z.null()]))),
});

export type DataTableProps = z.infer<typeof dataTableProps>;
