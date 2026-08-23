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
	const nums = values.map(Number).filter((n) => !Number.isNaN(n));
	if (nums.length < 2) return null;

	const min = Math.min(...nums);
	const max = Math.max(...nums);
	const span = max - min || 1;
	const x = (i: number) => (i / (nums.length - 1)) * (width - 2) + 1;
	const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
	const d = nums.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");

	return (
		<svg
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			className="not-prose inline-block align-middle"
			role="img"
		>
			{fill ? (
				<path d={`${d} L${width - 1} ${height} L1 ${height} Z`} fill={color} opacity="0.13" />
			) : null}
			<path
				d={d}
				fill="none"
				stroke={color}
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<circle cx={x(nums.length - 1)} cy={y(nums[nums.length - 1])} r="2" fill={color} />
		</svg>
	);
}
