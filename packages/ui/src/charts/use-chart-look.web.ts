import { CHART_TEXT, type ChartLook } from "./look";

const WEB_LOOK: ChartLook = {
	series: [
		"var(--chart-1)",
		"var(--chart-2)",
		"var(--chart-3)",
		"var(--chart-4)",
		"var(--chart-5)",
		"var(--chart-6)",
	],
	grid: "var(--chart-grid)",
	axis: "var(--chart-axis)",
	label: "var(--chart-label)",
	readout: "var(--text-heading)",
	card: "var(--surface-card)",
	hover: "var(--surface-hover)",
	text: {
		tick: { className: CHART_TEXT.tick },
		category: { className: CHART_TEXT.category },
		readout: { className: CHART_TEXT.readout },
	},
	color: (value) => value,
};

/**
 * The web's chart look: the tokens by reference, so a theme switch repaints the chart through
 * CSS alone, and an author's `color` is any CSS colour, used as written.
 */
export function useChartLook(): ChartLook {
	return WEB_LOOK;
}
