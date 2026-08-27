import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { ExpandModal } from "../ui/ExpandModal";
import Dropdown from "./Dropdown";
import {
	binValues,
	countTicks,
	edgeTickIndices,
	fitLabel,
	formatBinEdge,
	labelColumnWidth,
	niceMax,
	toNumber,
} from "./chart-data";

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
export type Orientation = ChartProps["orientation"];

interface PlotProps {
	type: ChartProps["type"];
	data: ChartDatum[];
	/** Series keys to plot, already defaulted. */
	keys: string[];
	unit?: string;
	orientation: Orientation;
	values: number[];
	bins?: number;
	/** Logical (viewBox) size. Inline charts fix the width at 640 and stretch to
	    the card; the expanded view passes the measured panel size so labels stay
	    at their native pixel size instead of scaling up with the viewBox. */
	width: number;
	height: number;
	/** Roomier padding and type for the full-screen view. */
	expanded?: boolean;
}

/** Padding preset shared by every coordinate system; `HorizontalBars`
    overrides `.left` with a label-driven width. */
function layout(expanded: boolean): { top: number; right: number; bottom: number; left: number } {
	return expanded
		? { top: 18, right: 16, bottom: 32, left: 52 }
		: { top: 12, right: 12, bottom: 26, left: 38 };
}

interface Pad {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/** Gridlines, mono tick labels and the `--chart-axis` baseline for a
    numeric axis — `"y"` (vertical value axis, horizontal gridlines,
    baseline along the bottom) for `VerticalPlot`/`HistogramBars`, `"x"`
    (horizontal value axis, vertical gridlines, baseline on the left) for
    `HorizontalBars`. */
function ValueGrid({
	axis,
	ticks,
	scale,
	pad,
	plotWidth,
	plotHeight,
	format,
	fontSize,
}: {
	axis: "x" | "y";
	ticks: number[];
	scale: (tick: number) => number;
	pad: Pad;
	plotWidth: number;
	plotHeight: number;
	format: (value: number) => string;
	fontSize: number;
}) {
	const innerH = plotHeight - pad.top - pad.bottom;
	const tickClass = "font-mono font-normal leading-[1.62] text-[length:var(--size-sm)]";
	if (axis === "y") {
		return (
			<>
				{ticks.map((tick) => (
					<g key={tick}>
						<line
							x1={pad.left}
							x2={plotWidth - pad.right}
							y1={scale(tick)}
							y2={scale(tick)}
							stroke="var(--chart-grid)"
							strokeWidth="1"
						/>
						<text
							x={pad.left - 8}
							y={scale(tick) + 3.5}
							textAnchor="end"
							className={tickClass}
							style={{ fontSize, fill: "var(--chart-label)" }}
						>
							{format(tick)}
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
			</>
		);
	}
	return (
		<>
			{ticks.map((tick) => (
				<g key={tick}>
					<line
						x1={scale(tick)}
						x2={scale(tick)}
						y1={pad.top}
						y2={pad.top + innerH}
						stroke="var(--chart-grid)"
						strokeWidth="1"
					/>
					<text
						x={scale(tick)}
						y={plotHeight - 8}
						textAnchor="middle"
						className={tickClass}
						style={{ fontSize, fill: "var(--chart-label)" }}
					>
						{format(tick)}
					</text>
				</g>
			))}
			<line
				x1={pad.left}
				x2={pad.left}
				y1={pad.top}
				y2={pad.top + innerH}
				stroke="var(--chart-axis)"
				strokeWidth="1"
			/>
		</>
	);
}

/** The hover value readout: bold mono text over the plot area. */
function HoverReadout({
	x,
	y,
	textAnchor = "middle",
	fontSize,
	text,
}: {
	x: number;
	y: number;
	textAnchor?: "start" | "middle" | "end";
	fontSize: number;
	text: string;
}) {
	return (
		<text
			x={x}
			y={y}
			textAnchor={textAnchor}
			className="font-mono leading-[1.62] text-[length:var(--size-sm)] font-semibold"
			style={{ fontSize, fill: "var(--text-heading)" }}
		>
			{text}
		</text>
	);
}

interface PlotBodyProps {
	unit?: string;
	width: number;
	height: number;
	expanded: boolean;
	fontSize: number;
}

/** Vertical bar / line / area — today's `ChartPlot` body, unchanged apart
    from `toNumber` and `countTicks`. */
function VerticalPlot({
	type,
	data,
	keys,
	unit,
	width: plotWidth,
	height: plotHeight,
	expanded,
	fontSize,
}: PlotBodyProps & { type: "bar" | "line" | "area"; data: ChartDatum[]; keys: string[] }) {
	const [hover, setHover] = useState(-1);
	const fmt = (value: number) => `${value}${unit ?? ""}`;
	const pad = layout(expanded);
	const innerW = plotWidth - pad.left - pad.right;
	const innerH = plotHeight - pad.top - pad.bottom;
	const max = niceMax(
		Math.max(1, ...data.flatMap((datum) => keys.map((key) => toNumber(datum[key])))),
	);
	const ticks = countTicks(max);
	const xAt = (index: number) => pad.left + (innerW / Math.max(1, data.length)) * (index + 0.5);
	const yAt = (value: number) => pad.top + innerH - (value / max) * innerH;
	const bandW = innerW / Math.max(1, data.length);
	const barW = Math.min(expanded ? 72 : 34, (bandW * 0.62) / keys.length);

	const linePath = (key: string) =>
		data
			.map(
				(datum, index) =>
					(index ? "L" : "M") + xAt(index).toFixed(1) + " " + yAt(toNumber(datum[key])).toFixed(1),
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
		<>
			<ValueGrid
				axis="y"
				ticks={ticks}
				scale={yAt}
				pad={pad}
				plotWidth={plotWidth}
				plotHeight={plotHeight}
				format={fmt}
				fontSize={fontSize}
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
									cy={yAt(toNumber(datum[key]))}
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
								const barH = Math.max(1, (toNumber(datum[key]) / max) * innerH);
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
				<HoverReadout
					x={xAt(hover)}
					y={pad.top - 2}
					fontSize={fontSize}
					text={keys.map((key) => fmt(toNumber(data[hover][key]))).join(" · ")}
				/>
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
		</>
	);
}

/** Horizontal bars — the mirror image of `VerticalPlot`: the value axis
    runs along x, categories stack along y, and the label column on the
    left is sized to the longest category label. */
function HorizontalBars({
	data,
	keys,
	unit,
	width: plotWidth,
	height: plotHeight,
	expanded,
	fontSize,
}: PlotBodyProps & { data: ChartDatum[]; keys: string[] }) {
	const [hover, setHover] = useState(-1);
	const fmt = (value: number) => `${value}${unit ?? ""}`;
	const labels = data.map((datum) => datum.label);
	const pad: Pad = {
		...layout(expanded),
		left: labelColumnWidth(labels, {
			fontSize,
			min: expanded ? 52 : 38,
			max: Math.min(expanded ? 260 : 180, plotWidth * 0.4),
		}),
	};
	const innerW = plotWidth - pad.left - pad.right;
	const innerH = plotHeight - pad.top - pad.bottom;
	const max = niceMax(
		Math.max(1, ...data.flatMap((datum) => keys.map((key) => toNumber(datum[key])))),
	);
	const ticks = countTicks(max);
	const yAt = (index: number) => pad.top + (innerH / Math.max(1, data.length)) * (index + 0.5);
	const bandH = innerH / Math.max(1, data.length);
	const barH = Math.min(expanded ? 72 : 34, (bandH * 0.62) / keys.length);

	return (
		<>
			<ValueGrid
				axis="x"
				ticks={ticks}
				scale={(tick) => pad.left + (tick / max) * innerW}
				pad={pad}
				plotWidth={plotWidth}
				plotHeight={plotHeight}
				format={fmt}
				fontSize={fontSize}
			/>
			{data.map((datum, index) => (
				<g key={index}>
					<rect
						x={pad.left}
						y={pad.top + bandH * index}
						width={innerW}
						height={bandH}
						fill={hover === index ? "var(--surface-hover)" : "transparent"}
					/>
					{keys.map((key, seriesIndex) => {
						const barY = yAt(index) - (barH * keys.length) / 2 + barH * seriesIndex;
						const barLength = Math.max(1, (toNumber(datum[key]) / max) * innerW);
						return (
							<rect
								key={key}
								x={pad.left}
								y={barY}
								width={barLength}
								height={barH - 2}
								rx="3"
								fill={SERIES_COLORS[seriesIndex % 6]}
								opacity={hover === -1 || hover === index ? 1 : 0.45}
							/>
						);
					})}
					<text
						x={pad.left - 8}
						y={yAt(index) + 3.5}
						textAnchor="end"
						className="font-sans font-medium leading-normal text-[length:var(--size-sm)]"
						style={{ fontSize, fill: "var(--chart-label)" }}
					>
						{fitLabel(datum.label, pad.left - 8, fontSize)}
					</text>
				</g>
			))}
			{hover >= 0 && data[hover] ? (
				<HoverReadout
					x={plotWidth - 4}
					y={pad.top - 4}
					textAnchor="end"
					fontSize={fontSize}
					text={keys.map((key) => fmt(toNumber(data[hover][key]))).join(" · ")}
				/>
			) : null}
			{data.map((_datum, index) => (
				<rect
					key={`hit${index}`}
					x={pad.left}
					y={pad.top + bandH * index}
					width={innerW}
					height={bandH}
					fill="transparent"
					onMouseEnter={() => setHover(index)}
					onMouseLeave={() => setHover(-1)}
				/>
			))}
		</>
	);
}

/** A histogram over raw `values`, binned on the client. Bars sit flush
    against each other (a 2px seam, no band padding); the x axis labels bin
    edges instead of categories. */
function HistogramBars({
	values,
	bins,
	unit,
	width: plotWidth,
	height: plotHeight,
	expanded,
	fontSize,
}: PlotBodyProps & { values: number[]; bins?: number }) {
	const [hover, setHover] = useState(-1);
	const binList = useMemo(() => binValues(values, bins), [values, bins]);
	const pad = layout(expanded);
	const innerW = plotWidth - pad.left - pad.right;
	const innerH = plotHeight - pad.top - pad.bottom;
	const max = niceMax(Math.max(1, ...binList.map((bin) => bin.value)));
	const ticks = countTicks(max);
	const binW = innerW / Math.max(1, binList.length);
	const edgeIndices = edgeTickIndices(binList.length + 1, expanded ? 12 : 8);
	const edgeStep = binList[0] ? binList[0].end - binList[0].start : 1;
	const edgeValue = (index: number) =>
		index < binList.length ? binList[index]!.start : (binList[binList.length - 1]?.end ?? 0);

	return (
		<>
			<ValueGrid
				axis="y"
				ticks={ticks}
				scale={(tick) => pad.top + innerH - (tick / max) * innerH}
				pad={pad}
				plotWidth={plotWidth}
				plotHeight={plotHeight}
				format={(value) => `${value}`}
				fontSize={fontSize}
			/>
			{binList.map((bin, index) => {
				const barHeight = bin.value > 0 ? Math.max(1, (bin.value / max) * innerH) : 0;
				return (
					<rect
						key={index}
						x={pad.left + binW * index}
						y={pad.top + innerH - barHeight}
						width={binW - 2}
						height={barHeight}
						fill="var(--chart-1)"
						opacity={hover === -1 || hover === index ? 1 : 0.45}
					/>
				);
			})}
			{binList.length > 0
				? edgeIndices.map((index) => (
						<text
							key={index}
							x={pad.left + binW * index}
							y={plotHeight - 8}
							textAnchor={index === 0 ? "start" : index === binList.length ? "end" : "middle"}
							className="font-mono font-normal leading-[1.62] text-[length:var(--size-sm)]"
							style={{ fontSize, fill: "var(--chart-label)" }}
						>
							{formatBinEdge(edgeValue(index), edgeStep)}
							{unit ?? ""}
						</text>
					))
				: null}
			{hover >= 0 && binList[hover] ? (
				<HoverReadout
					x={clampToPlot(pad.left + binW * (hover + 0.5), pad, plotWidth)}
					y={pad.top - 2}
					fontSize={fontSize}
					text={`${binList[hover]!.label}${unit ?? ""} · ${binList[hover]!.value}`}
				/>
			) : null}
			{binList.map((_bin, index) => (
				<rect
					key={`hit${index}`}
					x={pad.left + binW * index}
					y={pad.top}
					width={binW}
					height={innerH}
					fill="transparent"
					onMouseEnter={() => setHover(index)}
					onMouseLeave={() => setHover(-1)}
				/>
			))}
		</>
	);
}

/** Keeps the histogram hover readout inside the plot area so a bin near
    either edge can't push the text past the card's border. */
function clampToPlot(x: number, pad: Pad, plotWidth: number): number {
	return Math.min(plotWidth - pad.right - 4, Math.max(pad.left + 4, x));
}

/** The frame: one `<svg>` shared by every chart shape, sized by `layout()`
    and filled by whichever coordinate system `type`/`orientation` selects. */
function ChartPlot({
	type,
	data,
	keys,
	unit,
	orientation,
	values,
	bins,
	width: plotWidth,
	height: plotHeight,
	expanded = false,
}: PlotProps) {
	const fontSize = expanded ? 12 : 10;
	const body = { unit, width: plotWidth, height: plotHeight, expanded, fontSize };

	return (
		<svg
			viewBox={`0 0 ${plotWidth} ${plotHeight}`}
			width={expanded ? plotWidth : "100%"}
			height={plotHeight}
			role="img"
			className="block overflow-visible"
		>
			{type === "histogram" ? (
				<HistogramBars {...body} values={values} bins={bins} />
			) : type === "bar" && orientation === "horizontal" ? (
				<HorizontalBars {...body} data={data} keys={keys} />
			) : (
				<VerticalPlot {...body} type={type} data={data} keys={keys} />
			)}
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

const ORIENTATION_ICON: Record<Orientation, string> = {
	vertical: "chart-column",
	horizontal: "chart-bar",
};

const ORIENTATION_LABEL: Record<Orientation, string> = {
	vertical: "Vertical bars",
	horizontal: "Horizontal bars",
};

/**
 * Flips a bar chart's orientation for the reader's own view, the same way
 * `DirectionMenu` (`CodeBlock.tsx`) flips a flowchart's layout — the doc's
 * `orientation` prop, and anything exported or copied, stays as written.
 */
function OrientationMenu({
	value,
	authored,
	onChange,
}: {
	value: Orientation;
	authored: Orientation;
	onChange: (orientation: Orientation) => void;
}) {
	return (
		<Dropdown
			icon={ORIENTATION_ICON[value]}
			size="sm"
			label="Orientation"
			value={value}
			onChange={(next) => onChange(next as Orientation)}
			options={(["vertical", "horizontal"] as const).map((orientation) => ({
				value: orientation,
				label: ORIENTATION_LABEL[orientation],
				description: orientation === authored ? "As written" : undefined,
			}))}
		/>
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
	orientation = "vertical",
	data = [],
	series,
	values = [],
	bins,
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
	const [chosenOrientation, setChosenOrientation] = useState<{
		authored: Orientation;
		value: Orientation;
	} | null>(null);
	const shownOrientation =
		chosenOrientation !== null && chosenOrientation.authored === orientation
			? chosenOrientation.value
			: orientation;
	const isHorizontalBar = type === "bar" && shownOrientation === "horizontal";
	const showLegend = legend && keys.length > 1 && type !== "histogram";
	const plot = { type, data, keys, unit, orientation: shownOrientation, values, bins };
	const orientationMenu =
		type === "bar" ? (
			<OrientationMenu
				value={shownOrientation}
				authored={orientation}
				onChange={(next) => setChosenOrientation({ authored: orientation, value: next })}
			/>
		) : null;
	const hint =
		type === "histogram"
			? "Hover a bin for its range and count"
			: isHorizontalBar
				? "Hover a row for values"
				: "Hover a column for values";

	return (
		<figure className="not-prose overflow-hidden rounded-lg border border-border-default bg-surface-card">
			<div className="flex h-[38px] items-center gap-3 border-b border-border-subtle pr-2.5 pl-4">
				<Icon name="chart-column" size={13} className="text-text-subtle" />
				<span className="flex-1 font-mono font-normal leading-[1.62] text-[length:var(--size-xs)] text-text-subtle">
					{filename || type}
				</span>
				{showLegend ? <Legend keys={keys} /> : null}
				{orientationMenu}
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
				hint={hint}
				actions={orientationMenu}
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
