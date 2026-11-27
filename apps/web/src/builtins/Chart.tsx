import { useEffect, useRef, useState } from "react";
import SharedChart, {
	ChartAxisLabels,
	ChartLegend,
	ChartPlot,
	chartKeys,
	showsLegend,
	type ChartPlotProps,
	type Orientation,
} from "@mdxserve/ui/builtins/Chart";
import { type ChartProps } from "@mdxserve/shared/builtins/chart";
import { IconButton } from "../ui/IconButton";
import { ExpandModal } from "../ui/ExpandModal";
import Dropdown from "../ui/Dropdown";

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
	plot: Omit<ChartPlotProps, "width" | "height" | "expanded">;
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
					<ChartLegend keys={keys} />
				</div>
			) : null}
			<div className="flex min-h-0 flex-1 flex-col px-6 pt-4 pb-5">
				<div ref={areaRef} className="min-h-0 flex-1">
					{size && size.width > 0 && size.height > 0 ? (
						<ChartPlot {...plot} width={size.width} height={size.height} expanded />
					) : null}
				</div>
				<ChartAxisLabels xLabel={xLabel} yLabel={yLabel} />
			</div>
			{caption ? (
				<div className="shrink-0 border-t border-border-subtle px-6 py-2.5 font-sans font-medium leading-normal text-[length:var(--size-xs)] text-text-subtle">
					{caption}
				</div>
			) : null}
		</div>
	);
}

/**
 * The shared chart (@mdxserve/ui) with the web client's chrome in its header: the orientation
 * menu for a bar chart and the expand button, whose modal redraws the chart at the panel's size.
 */
export default function Chart(props: ChartProps) {
	const { type = "bar", orientation = "vertical", series, values = [], bins, unit } = props;
	const { data = [], filename, caption, xLabel, yLabel } = props;
	const keys = chartKeys(series);
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
		<>
			<SharedChart
				{...props}
				orientation={shownOrientation}
				actions={
					<>
						{orientationMenu}
						<IconButton
							icon="expand"
							label="Expand chart"
							size="sm"
							className="-mr-2"
							onClick={() => setExpanded(true)}
						/>
					</>
				}
			/>
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
					showLegend={showsLegend(props)}
					xLabel={xLabel}
					yLabel={yLabel}
					caption={caption}
				/>
			</ExpandModal>
		</>
	);
}
