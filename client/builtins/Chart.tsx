import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { ExpandModal } from "../ui/ExpandModal";

const SERIES_COLORS = [
	"var(--chart-1)",
	"var(--chart-2)",
	"var(--chart-3)",
	"var(--chart-4)",
	"var(--chart-5)",
	"var(--chart-6)",
];

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
	type: z.enum(["bar", "line", "area"]).default("bar").describe("Chart shape."),
	data: z
		.array(chartDatumSchema)
		.default([])
		.describe("One object per x position: `{ label, <series>: number }`."),
	series: z
		.array(z.string())
		.optional()
		.describe('Keys of `data` entries to plot. Defaults to `["value"]`.'),
	height: z.number().default(220).describe("SVG height in px."),
	filename: z.string().optional().describe("Header label; defaults to the chart type."),
	caption: z.string().optional().describe("Caption shown below the chart on a hairline rule."),
	xLabel: z.string().optional().describe("X-axis caption, rendered as uppercase mono."),
	yLabel: z.string().optional().describe("Y-axis caption, rendered as uppercase mono."),
	unit: z
		.string()
		.optional()
		.describe('Suffix appended to axis tick and tooltip values, e.g. "ms" or "%".'),
	legend: z
		.boolean()
		.default(true)
		.describe("Show the series legend in the header when there's more than one series."),
});

export type ChartProps = z.infer<typeof chartProps>;

function niceMax(value: number): number {
	if (value <= 0) return 1;
	const mag = Math.pow(10, Math.floor(Math.log10(value)));
	return Math.ceil(value / mag) * mag;
}

interface PlotProps {
	type: ChartProps["type"];
	data: ChartDatum[];
	/** Series keys to plot, already defaulted. */
	keys: string[];
	unit?: string;
	/** Logical (viewBox) size. Inline charts fix the width at 640 and stretch to
	    the card; the expanded view passes the measured panel size so labels stay
	    at their native pixel size instead of scaling up with the viewBox. */
	width: number;
	height: number;
	/** Roomier padding and type for the full-screen view. */
	expanded?: boolean;
}

/** The SVG itself: axes, grid, series and the hover hit columns. */
function ChartPlot({
	type,
	data,
	keys,
	unit,
	width: plotWidth,
	height: plotHeight,
	expanded = false,
}: PlotProps) {
	const [hover, setHover] = useState(-1);
	const fmt = (value: number) => `${value}${unit ?? ""}`;
	const fontSize = expanded ? 12 : 10;
	const pad = expanded
		? { top: 18, right: 16, bottom: 32, left: 52 }
		: { top: 12, right: 12, bottom: 26, left: 38 };
	const innerW = plotWidth - pad.left - pad.right;
	const innerH = plotHeight - pad.top - pad.bottom;
	const max = niceMax(
		Math.max(1, ...data.flatMap((datum) => keys.map((key) => Number(datum[key]) || 0))),
	);
	const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(max * fraction));
	const xAt = (index: number) => pad.left + (innerW / Math.max(1, data.length)) * (index + 0.5);
	const yAt = (value: number) => pad.top + innerH - (Number(value) / max) * innerH;

	const bandW = innerW / Math.max(1, data.length);
	const barW = Math.min(expanded ? 72 : 34, (bandW * 0.62) / keys.length);

	const linePath = (key: string) =>
		data
			.map(
				(datum, index) =>
					(index ? "L" : "M") + xAt(index).toFixed(1) + " " + yAt(Number(datum[key])).toFixed(1),
			)
			.join(" ");
	const areaPath = (key: string) =>
		linePath(key) +
		" L" +
		xAt(data.length - 1).toFixed(1) +
		" " +
		(pad.top + innerH) +
		" L" +
		xAt(0).toFixed(1) +
		" " +
		(pad.top + innerH) +
		" Z";

	return (
		<svg
			viewBox={`0 0 ${plotWidth} ${plotHeight}`}
			width={expanded ? plotWidth : "100%"}
			height={plotHeight}
			role="img"
			className="block overflow-visible"
		>
			{ticks.map((tick, index) => (
				<g key={index}>
					<line
						x1={pad.left}
						x2={plotWidth - pad.right}
						y1={yAt(tick)}
						y2={yAt(tick)}
						stroke="var(--chart-grid)"
						strokeWidth="1"
					/>
					<text
						x={pad.left - 8}
						y={yAt(tick) + 3.5}
						textAnchor="end"
						className="font-mono font-normal leading-[1.62] text-[length:var(--size-sm)]"
						style={{ fontSize, fill: "var(--chart-label)" }}
					>
						{fmt(tick)}
					</text>
				</g>
			))}
			<line
				x1={pad.left}
				x2={plotWidth - pad.right}
				y1={pad.top + innerH}
				y2={pad.top + innerH}
				stroke="var(--chart-axis)"
				strokeWidth="1"
			/>

			{type === "area"
				? keys.map((key, seriesIndex) => (
						<path
							key={`a${key}`}
							d={areaPath(key)}
							fill={SERIES_COLORS[seriesIndex % 6]}
							opacity="0.14"
						/>
					))
				: null}

			{type === "line" || type === "area"
				? keys.map((key, seriesIndex) => (
						<g key={`l${key}`}>
							<path
								d={linePath(key)}
								fill="none"
								stroke={SERIES_COLORS[seriesIndex % 6]}
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
							{data.map((datum, index) => (
								<circle
									key={index}
									cx={xAt(index)}
									cy={yAt(Number(datum[key]))}
									r={hover === index ? 4.5 : 3}
									fill="var(--surface-card)"
									stroke={SERIES_COLORS[seriesIndex % 6]}
									strokeWidth="2"
								/>
							))}
						</g>
					))
				: null}

			{type === "bar"
				? data.map((datum, index) => (
						<g key={index}>
							<rect
								x={pad.left + bandW * index}
								y={pad.top}
								width={bandW}
								height={innerH}
								fill={hover === index ? "var(--surface-hover)" : "transparent"}
							/>
							{keys.map((key, seriesIndex) => {
								const barX = xAt(index) - (barW * keys.length) / 2 + barW * seriesIndex;
								const barH = Math.max(1, ((Number(datum[key]) || 0) / max) * innerH);
								return (
									<rect
										key={key}
										x={barX}
										y={pad.top + innerH - barH}
										width={barW - 2}
										height={barH}
										rx="3"
										fill={SERIES_COLORS[seriesIndex % 6]}
										opacity={hover === -1 || hover === index ? 1 : 0.45}
									/>
								);
							})}
						</g>
					))
				: null}

			{data.map((datum, index) => (
				<text
					key={`x${index}`}
					x={xAt(index)}
					y={plotHeight - 8}
					textAnchor="middle"
					className="font-sans font-medium leading-normal text-[length:var(--size-sm)]"
					style={{ fontSize, fill: "var(--chart-label)" }}
				>
					{datum.label}
				</text>
			))}
			{hover >= 0 && data[hover] ? (
				<text
					x={xAt(hover)}
					y={pad.top - 2}
					textAnchor="middle"
					className="font-mono leading-[1.62] text-[length:var(--size-sm)] font-semibold"
					style={{ fontSize, fill: "var(--text-heading)" }}
				>
					{keys.map((key) => fmt(Number(data[hover][key]))).join(" · ")}
				</text>
			) : null}
			{/* One invisible hit column per x position, on top of every series, so
			    hover works the same for bars, lines and areas. */}
			{data.map((_datum, index) => (
				<rect
					key={`hit${index}`}
					x={pad.left + bandW * index}
					y={pad.top}
					width={bandW}
					height={innerH}
					fill="transparent"
					onMouseEnter={() => setHover(index)}
					onMouseLeave={() => setHover(-1)}
				/>
			))}
		</svg>
	);
}

function Legend({ keys }: { keys: string[] }) {
	return (
		<span className="flex gap-3">
			{keys.map((key, index) => (
				<span
					key={key}
					className="inline-flex items-center gap-1.5 font-sans font-medium leading-normal text-[length:var(--size-xs)] text-text-muted"
				>
					<span
						className="h-2 w-2 rounded-[2px]"
						style={{ background: SERIES_COLORS[index % 6] }}
					/>
					{key}
				</span>
			))}
		</span>
	);
}

function AxisLabels({ xLabel, yLabel }: { xLabel?: string; yLabel?: string }) {
	if (!xLabel && !yLabel) return null;
	return (
		<div className="mt-2 flex justify-between font-mono font-semibold leading-[1.2] text-[length:var(--size-2xs)] uppercase tracking-[var(--tracking-caps)] text-text-subtle">
			<span>{yLabel}</span>
			<span>{xLabel}</span>
		</div>
	);
}

/**
 * The modal body: measures the space it's given and redraws the chart at that
 * size, so the expanded view gains plot area rather than magnified type.
 */
function ExpandedChart({
	plot,
	keys,
	showLegend,
	xLabel,
	yLabel,
	caption,
}: {
	plot: Omit<PlotProps, "width" | "height" | "expanded">;
	keys: string[];
	showLegend: boolean;
	xLabel?: string;
	yLabel?: string;
	caption?: string;
}) {
	const areaRef = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState<{ width: number; height: number } | null>(null);

	useEffect(() => {
		const area = areaRef.current;
		if (!area) return;
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const { width, height } = entry.contentRect;
			setSize({ width: Math.floor(width), height: Math.floor(height) });
		});
		observer.observe(area);
		return () => observer.disconnect();
	}, []);

	return (
		<div className="flex h-full flex-col bg-surface-card">
			{showLegend ? (
				<div className="flex shrink-0 justify-end px-6 pt-4">
					<Legend keys={keys} />
				</div>
			) : null}
			<div className="flex min-h-0 flex-1 flex-col px-6 pt-4 pb-5">
				<div ref={areaRef} className="min-h-0 flex-1">
					{size && size.width > 0 && size.height > 0 ? (
						<ChartPlot {...plot} width={size.width} height={size.height} expanded />
					) : null}
				</div>
				<AxisLabels xLabel={xLabel} yLabel={yLabel} />
			</div>
			{caption ? (
				<div className="shrink-0 border-t border-border-subtle px-6 py-2.5 font-sans font-medium leading-normal text-[length:var(--size-xs)] text-text-subtle">
					{caption}
				</div>
			) : null}
		</div>
	);
}

export default function Chart({
	type = "bar",
	data = [],
	series,
	height = 220,
	filename,
	caption,
	xLabel,
	yLabel,
	unit,
	legend = true,
}: ChartProps) {
	const keys = series && series.length ? series : ["value"];
	const [expanded, setExpanded] = useState(false);
	const showLegend = legend && keys.length > 1;
	const plot = { type, data, keys, unit };

	return (
		<figure className="not-prose overflow-hidden rounded-lg border border-border-default bg-surface-card">
			<div className="flex h-[34px] items-center gap-3 border-b border-border-subtle px-4">
				<Icon name="chart-column" size={13} className="text-text-subtle" />
				<span className="flex-1 font-mono font-normal leading-[1.62] text-[length:var(--size-xs)] text-text-subtle">
					{filename || type}
				</span>
				{showLegend ? <Legend keys={keys} /> : null}
				<IconButton
					icon="expand"
					label="Expand chart"
					size="sm"
					className="-mr-2"
					onClick={() => setExpanded(true)}
				/>
			</div>
			<div className="p-4">
				<ChartPlot {...plot} width={640} height={height} />
				<AxisLabels xLabel={xLabel} yLabel={yLabel} />
			</div>
			{caption ? (
				<figcaption className="border-t border-border-subtle px-4 py-2.5 font-sans font-medium leading-normal text-[length:var(--size-xs)] text-text-subtle">
					{caption}
				</figcaption>
			) : null}
			<ExpandModal
				open={expanded}
				onClose={() => setExpanded(false)}
				icon="chart-column"
				title={filename || "Chart"}
				hint="Hover a column for values"
			>
				<ExpandedChart
					plot={plot}
					keys={keys}
					showLegend={showLegend}
					xLabel={xLabel}
					yLabel={yLabel}
					caption={caption}
				/>
			</ExpandModal>
		</figure>
	);
}
