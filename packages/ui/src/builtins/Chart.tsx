import { useMemo, useState, type ReactNode } from "react";
import { Platform, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { type ChartDatum, type ChartProps } from "@mdxserve/shared/builtins/chart";
import { Icon } from "../primitives/Icon";
import { webProps } from "../primitives/web-props";
import {
	binValues,
	countTicks,
	edgeTickIndices,
	fitLabel,
	formatBinEdge,
	labelColumnWidth,
	niceMax,
	toNumber,
} from "../charts/chart-data";
import { seriesColor, type ChartLook } from "../charts/look";
import { useChartLook } from "../charts/use-chart-look";

export type Orientation = ChartProps["orientation"];

/** Each series' legend swatch, in the order of `--chart-1` … `--chart-6`. */
const SWATCHES = [
	"bg-chart-1",
	"bg-chart-2",
	"bg-chart-3",
	"bg-chart-4",
	"bg-chart-5",
	"bg-chart-6",
];

/** The width an inline chart is drawn at on the web, where it then stretches to the card. */
const INLINE_WIDTH = 640;

/** The plot body's horizontal padding (`p-4` on each side), which the app's measured width
    includes. */
const BODY_INSET = 32;

export interface ChartPlotProps {
	type: ChartProps["type"];
	data: ChartDatum[];
	/** Series keys to plot, already defaulted. */
	keys: string[];
	unit?: string;
	orientation: Orientation;
	values: number[];
	bins?: number;
	/** Logical (viewBox) size. Inline charts on the web fix the width at 640 and stretch to
	    the card; the expanded view and the app pass the measured size so labels stay at their
	    native pixel size instead of scaling with the viewBox. */
	width: number;
	height: number;
	/** Roomier padding and type for the full-screen view. */
	expanded?: boolean;
}

interface Pad {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/** Padding preset shared by every coordinate system; `HorizontalBars`
    overrides `.left` with a label-driven width. */
function layout(expanded: boolean): Pad {
	return expanded
		? { top: 18, right: 16, bottom: 32, left: 52 }
		: { top: 12, right: 12, bottom: 26, left: 38 };
}

/**
 * What makes a column show its values: the pointer entering it on the web, a tap in the app
 * (a second tap on the same column hides them again).
 */
function hoverProps(
	index: number,
	hover: number,
	setHover: (index: number) => void,
): Record<string, unknown> {
	return Platform.OS === "web"
		? { onMouseEnter: () => setHover(index), onMouseLeave: () => setHover(-1) }
		: { onPress: () => setHover(hover === index ? -1 : index) };
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
	look,
}: {
	axis: "x" | "y";
	ticks: number[];
	scale: (tick: number) => number;
	pad: Pad;
	plotWidth: number;
	plotHeight: number;
	format: (value: number) => string;
	fontSize: number;
	look: ChartLook;
}) {
	const innerH = plotHeight - pad.top - pad.bottom;
	if (axis === "y") {
		return (
			<>
				{ticks.map((tick) => (
					<G key={tick}>
						<Line
							x1={pad.left}
							x2={plotWidth - pad.right}
							y1={scale(tick)}
							y2={scale(tick)}
							stroke={look.grid}
							strokeWidth="1"
						/>
						<SvgText
							x={pad.left - 8}
							y={scale(tick) + 3.5}
							textAnchor="end"
							{...look.text.tick}
							fontSize={fontSize}
							fill={look.label}
						>
							{format(tick)}
						</SvgText>
					</G>
				))}
				<Line
					x1={pad.left}
					x2={plotWidth - pad.right}
					y1={pad.top + innerH}
					y2={pad.top + innerH}
					stroke={look.axis}
					strokeWidth="1"
				/>
			</>
		);
	}
	return (
		<>
			{ticks.map((tick) => (
				<G key={tick}>
					<Line
						x1={scale(tick)}
						x2={scale(tick)}
						y1={pad.top}
						y2={pad.top + innerH}
						stroke={look.grid}
						strokeWidth="1"
					/>
					<SvgText
						x={scale(tick)}
						y={plotHeight - 8}
						textAnchor="middle"
						{...look.text.tick}
						fontSize={fontSize}
						fill={look.label}
					>
						{format(tick)}
					</SvgText>
				</G>
			))}
			<Line
				x1={pad.left}
				x2={pad.left}
				y1={pad.top}
				y2={pad.top + innerH}
				stroke={look.axis}
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
	look,
}: {
	x: number;
	y: number;
	textAnchor?: "start" | "middle" | "end";
	fontSize: number;
	text: string;
	look: ChartLook;
}) {
	return (
		<SvgText
			x={x}
			y={y}
			textAnchor={textAnchor}
			{...look.text.readout}
			fontSize={fontSize}
			fill={look.readout}
		>
			{text}
		</SvgText>
	);
}

interface PlotBodyProps {
	unit?: string;
	width: number;
	height: number;
	expanded: boolean;
	fontSize: number;
	look: ChartLook;
}

/** Vertical bar / line / area. */
function VerticalPlot({
	type,
	data,
	keys,
	unit,
	width: plotWidth,
	height: plotHeight,
	expanded,
	fontSize,
	look,
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
				look={look}
			/>
			{type === "area"
				? keys.map((key, seriesIndex) => (
						<Path
							key={`a${key}`}
							d={areaPath(key)}
							fill={seriesColor(look, seriesIndex)}
							opacity="0.14"
						/>
					))
				: null}
			{type === "line" || type === "area"
				? keys.map((key, seriesIndex) => (
						<G key={`l${key}`}>
							<Path
								d={linePath(key)}
								fill="none"
								stroke={seriesColor(look, seriesIndex)}
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
							{data.map((datum, index) => (
								<Circle
									key={index}
									cx={xAt(index)}
									cy={yAt(toNumber(datum[key]))}
									r={hover === index ? 4.5 : 3}
									fill={look.card}
									stroke={seriesColor(look, seriesIndex)}
									strokeWidth="2"
								/>
							))}
						</G>
					))
				: null}
			{type === "bar"
				? data.map((datum, index) => (
						<G key={index}>
							<Rect
								x={pad.left + bandW * index}
								y={pad.top}
								width={bandW}
								height={innerH}
								fill={hover === index ? look.hover : "transparent"}
							/>
							{keys.map((key, seriesIndex) => {
								const barX = xAt(index) - (barW * keys.length) / 2 + barW * seriesIndex;
								const barH = Math.max(1, (toNumber(datum[key]) / max) * innerH);
								return (
									<Rect
										key={key}
										x={barX}
										y={pad.top + innerH - barH}
										width={barW - 2}
										height={barH}
										rx="3"
										fill={seriesColor(look, seriesIndex)}
										opacity={hover === -1 || hover === index ? 1 : 0.45}
									/>
								);
							})}
						</G>
					))
				: null}
			{data.map((datum, index) => (
				<SvgText
					key={`x${index}`}
					x={xAt(index)}
					y={plotHeight - 8}
					textAnchor="middle"
					{...look.text.category}
					fontSize={fontSize}
					fill={look.label}
				>
					{datum.label}
				</SvgText>
			))}
			{hover >= 0 && data[hover] ? (
				<HoverReadout
					x={xAt(hover)}
					y={pad.top - 2}
					fontSize={fontSize}
					look={look}
					text={keys.map((key) => fmt(toNumber(data[hover][key]))).join(" · ")}
				/>
			) : null}
			{/* One invisible hit column per x position, on top of every series, so
			    hover works the same for bars, lines and areas. */}
			{data.map((_datum, index) => (
				<Rect
					key={`hit${index}`}
					x={pad.left + bandW * index}
					y={pad.top}
					width={bandW}
					height={innerH}
					fill="transparent"
					{...hoverProps(index, hover, setHover)}
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
	look,
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
				look={look}
			/>
			{data.map((datum, index) => (
				<G key={index}>
					<Rect
						x={pad.left}
						y={pad.top + bandH * index}
						width={innerW}
						height={bandH}
						fill={hover === index ? look.hover : "transparent"}
					/>
					{keys.map((key, seriesIndex) => {
						const barY = yAt(index) - (barH * keys.length) / 2 + barH * seriesIndex;
						const barLength = Math.max(1, (toNumber(datum[key]) / max) * innerW);
						return (
							<Rect
								key={key}
								x={pad.left}
								y={barY}
								width={barLength}
								height={barH - 2}
								rx="3"
								fill={seriesColor(look, seriesIndex)}
								opacity={hover === -1 || hover === index ? 1 : 0.45}
							/>
						);
					})}
					<SvgText
						x={pad.left - 8}
						y={yAt(index) + 3.5}
						textAnchor="end"
						{...look.text.category}
						fontSize={fontSize}
						fill={look.label}
					>
						{fitLabel(datum.label, pad.left - 8, fontSize)}
					</SvgText>
				</G>
			))}
			{hover >= 0 && data[hover] ? (
				<HoverReadout
					x={plotWidth - 4}
					y={pad.top - 4}
					textAnchor="end"
					fontSize={fontSize}
					look={look}
					text={keys.map((key) => fmt(toNumber(data[hover][key]))).join(" · ")}
				/>
			) : null}
			{data.map((_datum, index) => (
				<Rect
					key={`hit${index}`}
					x={pad.left}
					y={pad.top + bandH * index}
					width={innerW}
					height={bandH}
					fill="transparent"
					{...hoverProps(index, hover, setHover)}
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
	look,
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
				look={look}
			/>
			{binList.map((bin, index) => {
				const barHeight = bin.value > 0 ? Math.max(1, (bin.value / max) * innerH) : 0;
				return (
					<Rect
						key={index}
						x={pad.left + binW * index}
						y={pad.top + innerH - barHeight}
						width={binW - 2}
						height={barHeight}
						fill={seriesColor(look, 0)}
						opacity={hover === -1 || hover === index ? 1 : 0.45}
					/>
				);
			})}
			{binList.length > 0
				? edgeIndices.map((index) => (
						<SvgText
							key={index}
							x={pad.left + binW * index}
							y={plotHeight - 8}
							textAnchor={index === 0 ? "start" : index === binList.length ? "end" : "middle"}
							{...look.text.tick}
							fontSize={fontSize}
							fill={look.label}
						>
							{formatBinEdge(edgeValue(index), edgeStep)}
							{unit ?? ""}
						</SvgText>
					))
				: null}
			{hover >= 0 && binList[hover] ? (
				<HoverReadout
					x={clampToPlot(pad.left + binW * (hover + 0.5), pad, plotWidth)}
					y={pad.top - 2}
					fontSize={fontSize}
					look={look}
					text={`${binList[hover]!.label}${unit ?? ""} · ${binList[hover]!.value}`}
				/>
			) : null}
			{binList.map((_bin, index) => (
				<Rect
					key={`hit${index}`}
					x={pad.left + binW * index}
					y={pad.top}
					width={binW}
					height={innerH}
					fill="transparent"
					{...hoverProps(index, hover, setHover)}
				/>
			))}
		</>
	);
}

/** The plot: one SVG shared by every chart shape, sized by `layout()` and filled by whichever
    coordinate system `type`/`orientation` selects. */
export function ChartPlot({
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
}: ChartPlotProps) {
	const look = useChartLook();
	const fontSize = expanded ? 12 : 10;
	const body = { unit, width: plotWidth, height: plotHeight, expanded, fontSize, look };
	const stretches = !expanded && Platform.OS === "web";

	return (
		<Svg
			viewBox={`0 0 ${plotWidth} ${plotHeight}`}
			width={stretches ? "100%" : plotWidth}
			height={plotHeight}
			role="img"
			{...webProps({ className: "block overflow-visible" })}
		>
			{type === "histogram" ? (
				<HistogramBars {...body} values={values} bins={bins} />
			) : type === "bar" && orientation === "horizontal" ? (
				<HorizontalBars {...body} data={data} keys={keys} />
			) : (
				<VerticalPlot {...body} type={type} data={data} keys={keys} />
			)}
		</Svg>
	);
}

/** The series keys a chart plots: its `series`, else the one `value` key. */
export function chartKeys(series: ChartProps["series"]): string[] {
	return series && series.length ? series : ["value"];
}

/** Whether a chart shows its legend: more than one series, and not a histogram. */
export function showsLegend({ legend = true, type = "bar", series }: Partial<ChartProps>): boolean {
	return legend && chartKeys(series).length > 1 && type !== "histogram";
}

export function ChartLegend({ keys }: { keys: string[] }) {
	return (
		<View className="flex-row gap-3">
			{keys.map((key, index) => (
				<View key={key} className="flex-row items-center gap-1.5">
					<View className={`h-2 w-2 rounded-[2px] ${SWATCHES[index % SWATCHES.length]}`} />
					<Text className="font-sans font-medium leading-normal text-[length:var(--size-xs)] text-text-muted">
						{key}
					</Text>
				</View>
			))}
		</View>
	);
}

export function ChartAxisLabels({ xLabel, yLabel }: { xLabel?: string; yLabel?: string }) {
	if (!xLabel && !yLabel) return null;
	const caps =
		"font-mono font-semibold leading-[1.2] text-[length:var(--size-2xs)] uppercase tracking-[var(--tracking-caps)] text-text-subtle";
	return (
		<View className="mt-2 flex-row justify-between">
			<Text className={caps}>{yLabel}</Text>
			<Text className={caps}>{xLabel}</Text>
		</View>
	);
}

export interface ChartFrameProps extends Partial<ChartProps> {
	/** Controls at the right of the header: the web client's orientation menu and expand
	    button. */
	actions?: ReactNode;
}

/**
 * A chart in its card: a header with the file name, the legend and the caller's `actions`, the
 * plot, the axis captions and the caption. On the web the plot is drawn 640 wide and stretches
 * to the card; in the app it is drawn at the width the card lays out, so its type stays at
 * its own size on a phone.
 */
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
	actions,
}: ChartFrameProps) {
	const keys = chartKeys(series);
	const [plotWidth, setPlotWidth] = useState(INLINE_WIDTH);
	const measure =
		Platform.OS === "web"
			? undefined
			: (event: LayoutChangeEvent) => {
					const width = Math.floor(event.nativeEvent.layout.width) - BODY_INSET;
					if (width > 0) setPlotWidth(width);
				};

	return (
		<View
			{...webProps({ role: "figure" })}
			className="not-prose overflow-hidden rounded-lg border border-border-default bg-surface-card"
		>
			{/* Every web `View` is its own stacking context (react-native-web gives it z-index 0),
			    so the header sits above the plot for its menu to open over it. */}
			<View className="z-[1] h-[38px] flex-row items-center gap-3 border-b border-border-subtle pr-2.5 pl-4">
				<Icon name="chart-column" size={13} className="text-text-subtle" />
				<Text className="flex-1 font-mono font-normal leading-[1.62] text-[length:var(--size-xs)] text-text-subtle">
					{filename || type}
				</Text>
				{showsLegend({ legend, type, series }) ? <ChartLegend keys={keys} /> : null}
				{actions}
			</View>
			<View className="p-4" onLayout={measure}>
				<ChartPlot
					type={type}
					data={data}
					keys={keys}
					unit={unit}
					orientation={orientation}
					values={values}
					bins={bins}
					width={plotWidth}
					height={height}
				/>
				<ChartAxisLabels xLabel={xLabel} yLabel={yLabel} />
			</View>
			{caption ? (
				<View className="border-t border-border-subtle px-4 py-2.5">
					<Text className="font-sans font-medium leading-normal text-[length:var(--size-xs)] text-text-subtle">
						{caption}
					</Text>
				</View>
			) : null}
		</View>
	);
}
