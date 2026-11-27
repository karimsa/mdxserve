import { useMemo } from "react";
import { useResolveClassNames } from "uniwind";
import { CHART_TEXT, type ChartLook } from "./look";

/** The colour a `text-*` class resolves to in the current theme. */
function useTextColor(className: string): string {
	const style = useResolveClassNames(className);
	return typeof style.color === "string" ? style.color : "transparent";
}

/** The font family and weight a type class resolves to; the size is the chart's own. */
function useTextFont(className: string): object {
	const { fontFamily, fontWeight } = useResolveClassNames(className);
	return useMemo(() => ({ fontFamily, fontWeight }), [fontFamily, fontWeight]);
}

const AUTHOR_TOKEN = /^var\(\s*--([\w-]+)\s*\)$/;

/**
 * The app's chart look: each token resolved through a class, as `Icon` resolves its colour, so
 * the values follow the theme and every class is one the app's stylesheet compiles. An
 * author's `color="var(--chart-3)"` becomes that series colour; any other CSS variable, which
 * the app cannot read, falls back to `--chart-1`; a literal colour is used as written.
 */
export function useChartLook(): ChartLook {
	const series = [
		useTextColor("text-chart-1"),
		useTextColor("text-chart-2"),
		useTextColor("text-chart-3"),
		useTextColor("text-chart-4"),
		useTextColor("text-chart-5"),
		useTextColor("text-chart-6"),
	];
	const grid = useTextColor("text-chart-grid");
	const axis = useTextColor("text-chart-axis");
	const label = useTextColor("text-chart-label");
	const readout = useTextColor("text-text-heading");
	const card = useTextColor("text-surface-card");
	const hover = useTextColor("text-surface-hover");
	const tick = useTextFont(CHART_TEXT.tick);
	const category = useTextFont(CHART_TEXT.category);
	const readoutFont = useTextFont(CHART_TEXT.readout);
	const seriesKey = series.join("|");
	return useMemo(() => {
		const palette = seriesKey.split("|");
		return {
			series: palette,
			grid,
			axis,
			label,
			readout,
			card,
			hover,
			text: { tick, category, readout: readoutFont },
			color(value: string) {
				const token = AUTHOR_TOKEN.exec(value)?.[1];
				if (token === undefined) return value;
				const seriesIndex = /^chart-([1-6])$/.exec(token)?.[1];
				return palette[seriesIndex ? Number(seriesIndex) - 1 : 0]!;
			},
		};
	}, [seriesKey, grid, axis, label, readout, card, hover, tick, category, readoutFont]);
}
