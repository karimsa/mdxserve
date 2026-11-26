import { z } from "zod";
import { statefulIdProp } from "./id";

export interface ChartDatum {
	label: string;
	[series: string]: string | number;
}

// A chart datum is `{ label, <series>: number }` with series keys chosen by
// the author (`series` below lists which keys to plot) — z.record covers the
// open-ended numeric keys while `label` stays required and typed.
const chartDatumSchema = z
	.record(z.string(), z.union([z.string(), z.number()]))
	.and(z.object({ label: z.string() }));

export const chartProps = z.object({
	id: statefulIdProp,
	type: z
		.enum(["bar", "line", "area", "histogram"])
		.default("bar")
		.describe("Chart shape. `histogram` bins `values` on the client and ignores `data`/`series`."),
	orientation: z
		.enum(["vertical", "horizontal"])
		.default("vertical")
		.describe(
			"Bar layout direction; ignored for `line`/`area`/`histogram`. Readers can flip it from the chart header for their own view only.",
		),
	data: z
		.array(chartDatumSchema)
		.default([])
		.describe("One object per x position: `{ label, <series>: number }`."),
	series: z
		.array(z.string())
		.optional()
		.describe('Keys of `data` entries to plot. Defaults to `["value"]`.'),
	values: z
		.array(z.number())
		.default([])
		.describe('Raw numbers to bin for `type="histogram"`; ignored otherwise.'),
	bins: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Histogram bin count. Defaults to a Sturges estimate, capped at 20."),
	height: z.number().default(220).describe("SVG height in px."),
	filename: z.string().optional().describe("Header label; defaults to the chart type."),
	caption: z.string().optional().describe("Caption shown below the chart on a hairline rule."),
	xLabel: z
		.string()
		.optional()
		.describe(
			"Caption for the horizontal axis, rendered as uppercase mono — the categories on a vertical bar, line or area chart; the values on a horizontal bar chart or a histogram.",
		),
	yLabel: z
		.string()
		.optional()
		.describe(
			"Caption for the vertical axis, rendered as uppercase mono — the values on a vertical bar, line or area chart; the categories on a horizontal bar chart; the count on a histogram.",
		),
	unit: z
		.string()
		.optional()
		.describe(
			'Suffix appended to axis tick and tooltip values, e.g. "ms" or "%". On a histogram it labels the value axis (x); y is a count.',
		),
	legend: z
		.boolean()
		.default(true)
		.describe("Show the series legend in the header when there's more than one series."),
});

export type ChartProps = z.infer<typeof chartProps>;
