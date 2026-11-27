import type { ReactNode } from "react";
import { z } from "zod";

export const tooltipProps = z.object({
	content: z.string().describe("Tooltip text shown on hover/focus."),
	placement: z
		.enum(["top", "bottom", "left", "right"])
		.default("top")
		.describe("Preferred side of the target."),
	delay: z.number().default(100).describe("Delay in milliseconds before the tooltip appears."),
	children: z.custom<ReactNode>().describe("The element the tooltip is attached to."),
});

export type TooltipProps = z.infer<typeof tooltipProps>;
