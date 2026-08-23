import { useState } from "react";
import { z } from "zod";
import { Icon } from "../ui/Icon";

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
	const [hover, setHover] = useState(-1);
	const fmt = (value: number) => `${value}${unit ?? ""}`;
	const pad = { top: 12, right: 12, bottom: 26, left: 38 };
	const w = 640;
	const h = height;
	const innerW = w - pad.left - pad.right;
	const innerH = h - pad.top - pad.bottom;
	const max = niceMax(Math.max(1, ...data.flatMap((d) => keys.map((k) => Number(d[k]) || 0))));
	const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));
	const x = (i: number) => pad.left + (innerW / Math.max(1, data.length)) * (i + 0.5);
	const y = (v: number) => pad.top + innerH - (Number(v) / max) * innerH;

	const bandW = innerW / Math.max(1, data.length);
	const barW = Math.min(34, (bandW * 0.62) / keys.length);

	const linePath = (k: string) =>
		data
			.map((d, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(Number(d[k])).toFixed(1))
			.join(" ");
	const areaPath = (k: string) =>
		linePath(k) +
		" L" +
		x(data.length - 1).toFixed(1) +
		" " +
		(pad.top + innerH) +
		" L" +
		x(0).toFixed(1) +
		" " +
		(pad.top + innerH) +
		" Z";

	return (
		<figure className="not-prose overflow-hidden rounded-lg border border-border-default bg-surface-card">
			{filename || legend ? (
				<div className="flex h-[34px] items-center gap-3 border-b border-border-subtle px-4">
					<Icon name="chart-column" size={13} className="text-text-subtle" />
					<span className="flex-1 font-mono font-normal leading-[1.62] text-[length:var(--size-xs)] text-text-subtle">
						{filename || type}
					</span>
					{legend && keys.length > 1 ? (
						<span className="flex gap-3">
							{keys.map((k, i) => (
								<span
									key={k}
									className="inline-flex items-center gap-1.5 font-sans font-medium leading-normal text-[length:var(--size-xs)] text-text-muted"
								>
									<span
										className="h-2 w-2 rounded-[2px]"
										style={{ background: SERIES_COLORS[i % 6] }}
									/>
									{k}
								</span>
							))}
						</span>
					) : null}
				</div>
			) : null}
			<div className="p-4">
				<svg
					viewBox={`0 0 ${w} ${h}`}
					width="100%"
					height={h}
					role="img"
					className="block overflow-visible"
				>
					{ticks.map((t, i) => (
						<g key={i}>
							<line
								x1={pad.left}
								x2={w - pad.right}
								y1={y(t)}
								y2={y(t)}
								stroke="var(--chart-grid)"
								strokeWidth="1"
							/>
							<text
								x={pad.left - 8}
								y={y(t) + 3.5}
								textAnchor="end"
								className="font-mono font-normal leading-[1.62] text-[length:var(--size-sm)]"
								style={{ fontSize: 10, fill: "var(--chart-label)" }}
							>
								{fmt(t)}
							</text>
						</g>
					))}
					<line
						x1={pad.left}
						x2={w - pad.right}
						y1={pad.top + innerH}
						y2={pad.top + innerH}
						stroke="var(--chart-axis)"
						strokeWidth="1"
					/>

					{type === "area"
						? keys.map((k, si) => (
								<path key={`a${k}`} d={areaPath(k)} fill={SERIES_COLORS[si % 6]} opacity="0.14" />
							))
						: null}

					{type === "line" || type === "area"
						? keys.map((k, si) => (
								<g key={`l${k}`}>
									<path
										d={linePath(k)}
										fill="none"
										stroke={SERIES_COLORS[si % 6]}
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
									{data.map((d, i) => (
										<circle
											key={i}
											cx={x(i)}
											cy={y(Number(d[k]))}
											r={hover === i ? 4.5 : 3}
											fill="var(--surface-card)"
											stroke={SERIES_COLORS[si % 6]}
											strokeWidth="2"
										/>
									))}
								</g>
							))
						: null}

					{type === "bar"
						? data.map((d, i) => (
								<g key={i}>
									<rect
										x={pad.left + bandW * i}
										y={pad.top}
										width={bandW}
										height={innerH}
										fill={hover === i ? "var(--surface-hover)" : "transparent"}
									/>
									{keys.map((k, si) => {
										const bx = x(i) - (barW * keys.length) / 2 + barW * si;
										const bh = Math.max(1, ((Number(d[k]) || 0) / max) * innerH);
										return (
											<rect
												key={k}
												x={bx}
												y={pad.top + innerH - bh}
												width={barW - 2}
												height={bh}
												rx="3"
												fill={SERIES_COLORS[si % 6]}
												opacity={hover === -1 || hover === i ? 1 : 0.45}
											/>
										);
									})}
								</g>
							))
						: null}

					{data.map((d, i) => (
						<text
							key={`x${i}`}
							x={x(i)}
							y={h - 8}
							textAnchor="middle"
							className="font-sans font-medium leading-normal text-[length:var(--size-sm)]"
							style={{ fontSize: 10, fill: "var(--chart-label)" }}
						>
							{d.label}
						</text>
					))}
					{hover >= 0 && data[hover] ? (
						<text
							x={x(hover)}
							y={pad.top - 2}
							textAnchor="middle"
							className="font-mono leading-[1.62] text-[length:var(--size-sm)] font-semibold"
							style={{ fontSize: 10, fill: "var(--text-heading)" }}
						>
							{keys.map((k) => fmt(Number(data[hover][k]))).join(" · ")}
						</text>
					) : null}
					{/* One invisible hit column per x position, on top of every series, so
					    hover works the same for bars, lines and areas. */}
					{data.map((_, i) => (
						<rect
							key={`hit${i}`}
							x={pad.left + bandW * i}
							y={pad.top}
							width={bandW}
							height={innerH}
							fill="transparent"
							onMouseEnter={() => setHover(i)}
							onMouseLeave={() => setHover(-1)}
						/>
					))}
				</svg>
				{xLabel || yLabel ? (
					<div className="mt-2 flex justify-between font-mono font-semibold leading-[1.2] text-[length:var(--size-2xs)] uppercase tracking-[var(--tracking-caps)] text-text-subtle">
						<span>{yLabel}</span>
						<span>{xLabel}</span>
					</div>
				) : null}
			</div>
			{caption ? (
				<figcaption className="border-t border-border-subtle px-4 py-2.5 font-sans font-medium leading-normal text-[length:var(--size-xs)] text-text-subtle">
					{caption}
				</figcaption>
			) : null}
		</figure>
	);
}
