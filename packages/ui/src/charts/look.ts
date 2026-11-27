/** The type of each kind of label a chart draws inside its SVG. */
export const CHART_TEXT = {
	/** Value-axis ticks and histogram bin edges. */
	tick: "font-mono font-normal leading-[1.62] text-[length:var(--size-sm)]",
	/** Category labels. */
	category: "font-sans font-medium leading-normal text-[length:var(--size-sm)]",
	/** The value readout shown over the hovered (or, in the app, tapped) column. */
	readout: "font-mono leading-[1.62] text-[length:var(--size-sm)] font-semibold",
} as const;

type ChartTextRole = keyof typeof CHART_TEXT;

/**
 * What a chart paints with. An SVG shape takes its colours and fonts as props, not classes:
 * on the web they are the tokens' `var(--…)` references and the type classes
 * (use-chart-look.web.ts); in the app, which has no CSS variables at draw time, they are the
 * concrete values Uniwind resolves for the current theme (use-chart-look.ts).
 */
export interface ChartLook {
	/** `--chart-1` … `--chart-6`, the categorical series in order of use. */
	series: readonly string[];
	grid: string;
	axis: string;
	label: string;
	/** The hover readout's colour (`--text-heading`). */
	readout: string;
	/** A line chart's point fill (`--surface-card`). */
	card: string;
	/** The hovered column's band (`--surface-hover`). */
	hover: string;
	/** Props for an SVG `<Text>` of each role. */
	text: Readonly<Record<ChartTextRole, object>>;
	/** An author's colour (a `color` prop) as this platform can paint it. */
	color(value: string): string;
}

/** The series colour for the `index`th series, wrapping after six. */
export function seriesColor(look: ChartLook, index: number): string {
	return look.series[index % look.series.length]!;
}
