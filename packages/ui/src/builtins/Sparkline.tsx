import Svg, { Circle, Path } from "react-native-svg";
import { type SparklineProps } from "@mdxserve/shared/builtins/sparkline";
import { webProps } from "../primitives/web-props";
import { useChartLook } from "../charts/use-chart-look";

/** A small trend line that sits in a line of text. Fewer than two numbers draw nothing. */
export default function Sparkline({
	values = [],
	width = 84,
	height = 20,
	color = "var(--chart-1)",
	fill = true,
}: SparklineProps) {
	const look = useChartLook();
	const nums = values.map(Number).filter((value) => !Number.isNaN(value));
	if (nums.length < 2) return null;

	const paint = look.color(color);
	const min = Math.min(...nums);
	const max = Math.max(...nums);
	const span = max - min || 1;
	const xAt = (index: number) => (index / (nums.length - 1)) * (width - 2) + 1;
	const yAt = (value: number) => height - 2 - ((value - min) / span) * (height - 4);
	const pathData = nums
		.map(
			(value, index) => (index ? "L" : "M") + xAt(index).toFixed(1) + " " + yAt(value).toFixed(1),
		)
		.join(" ");

	return (
		<Svg
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			role="img"
			{...webProps({ className: "not-prose inline-block align-middle" })}
		>
			{fill ? (
				<Path
					d={`${pathData} L${width - 1} ${height} L1 ${height} Z`}
					fill={paint}
					opacity="0.13"
				/>
			) : null}
			<Path
				d={pathData}
				fill="none"
				stroke={paint}
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<Circle cx={xAt(nums.length - 1)} cy={yAt(nums[nums.length - 1]!)} r="2" fill={paint} />
		</Svg>
	);
}
