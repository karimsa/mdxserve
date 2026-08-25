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

export default function Sparkline({
	values = [],
	width = 84,
	height = 20,
	color = "var(--chart-1)",
	fill = true,
}: SparklineProps) {
	const nums = values.map(Number).filter((value) => !Number.isNaN(value));
	if (nums.length < 2) return null;

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
		<svg
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			className="not-prose inline-block align-middle"
			role="img"
		>
			{fill ? (
				<path
					d={`${pathData} L${width - 1} ${height} L1 ${height} Z`}
					fill={color}
					opacity="0.13"
				/>
			) : null}
			<path
				d={pathData}
				fill="none"
				stroke={color}
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<circle cx={xAt(nums.length - 1)} cy={yAt(nums[nums.length - 1])} r="2" fill={color} />
		</svg>
	);
}
