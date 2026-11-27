import type { ReactNode } from "react";
import { z } from "zod";

export const badgeProps = z.object({
	tone: z
		.enum(["neutral", "teal", "info", "ok", "warn", "danger", "note"])
		.default("neutral")
		.describe("Tone of the badge."),
	color: z
		.enum(["gray", "sky", "green", "amber", "red", "violet"])
		.optional()
		.describe(
			"Deprecated alias for `tone` (gray→neutral, sky→info, green→ok, amber→warn, red→danger, violet→note). Prefer `tone`.",
		),
	variant: z.enum(["soft", "solid", "outline"]).default("soft").describe("Fill style."),
	dot: z.boolean().default(false).describe("Show a leading status dot."),
	children: z.custom<ReactNode>().describe("Badge label."),
});

export type BadgeProps = z.infer<typeof badgeProps>;
