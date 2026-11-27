import { z } from "zod";

export const sparklineProps = z.object({
	values: z.array(z.number()).describe("Series to plot; at least two numbers."),
	width: z.number().default(84).describe("SVG width in px."),
	height: z.number().default(20).describe("SVG height in px."),
	color: z
		.string()
		.default("var(--chart-1)")
		.describe("Any CSS color, typically a `--chart-1`..`--chart-6` token."),
	fill: z.boolean().default(true).describe("Tinted area under the line."),
});

export type SparklineProps = z.infer<typeof sparklineProps>;
