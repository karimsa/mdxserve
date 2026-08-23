import type { ReactNode } from "react";
import { z } from "zod";

export const badgeProps = z.object({
	color: z
		.enum(["gray", "sky", "green", "amber", "red", "violet"])
		.default("gray")
		.describe("Color of the badge."),
	variant: z.enum(["soft", "solid", "outline"]).default("soft").describe("Fill style."),
	dot: z.boolean().default(false).describe("Show a leading status dot."),
	children: z.custom<ReactNode>().describe("Badge label."),
});

export type BadgeProps = z.infer<typeof badgeProps>;

type Color = NonNullable<BadgeProps["color"]>;
type Variant = NonNullable<BadgeProps["variant"]>;

const colorStyles: Record<Color, Record<Variant, string>> = {
	gray: {
		soft: "bg-gray-50 text-gray-600 ring-1 ring-inset ring-gray-500/10 dark:bg-gray-400/10 dark:text-gray-400 dark:ring-gray-400/20",
		solid: "bg-gray-600 text-white dark:bg-gray-500",
		outline:
			"text-gray-600 ring-1 ring-inset ring-gray-500/40 dark:text-gray-400 dark:ring-gray-400/40",
	},
	sky: {
		soft: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20 dark:bg-sky-400/10 dark:text-sky-400 dark:ring-sky-400/30",
		solid: "bg-sky-600 text-white",
		outline:
			"text-sky-700 ring-1 ring-inset ring-sky-600/40 dark:text-sky-300 dark:ring-sky-400/40",
	},
	green: {
		soft: "bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20 dark:bg-green-400/10 dark:text-green-400 dark:ring-green-400/30",
		solid: "bg-green-600 text-white",
		outline:
			"text-green-700 ring-1 ring-inset ring-green-600/40 dark:text-green-300 dark:ring-green-400/40",
	},
	amber: {
		soft: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-400/10 dark:text-amber-400 dark:ring-amber-400/30",
		solid: "bg-amber-600 text-white",
		outline:
			"text-amber-700 ring-1 ring-inset ring-amber-600/40 dark:text-amber-300 dark:ring-amber-400/40",
	},
	red: {
		soft: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-400/10 dark:text-red-400 dark:ring-red-400/30",
		solid: "bg-red-600 text-white",
		outline:
			"text-red-700 ring-1 ring-inset ring-red-600/40 dark:text-red-300 dark:ring-red-400/40",
	},
	violet: {
		soft: "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-600/20 dark:bg-violet-400/10 dark:text-violet-400 dark:ring-violet-400/30",
		solid: "bg-violet-600 text-white",
		outline:
			"text-violet-700 ring-1 ring-inset ring-violet-600/40 dark:text-violet-300 dark:ring-violet-400/40",
	},
};

const dotColorStyles: Record<Color, string> = {
	gray: "bg-gray-500",
	sky: "bg-sky-600 dark:bg-sky-400",
	green: "bg-green-600 dark:bg-green-400",
	amber: "bg-amber-600 dark:bg-amber-400",
	red: "bg-red-600 dark:bg-red-400",
	violet: "bg-violet-600 dark:bg-violet-400",
};

export default function Badge({
	color = "gray",
	variant = "soft",
	dot = false,
	children,
}: BadgeProps) {
	return (
		<span
			className={`not-prose inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${colorStyles[color][variant]}`}
		>
			{dot ? (
				<span
					className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColorStyles[color]}`}
					aria-hidden="true"
				/>
			) : null}
			{children}
		</span>
	);
}
