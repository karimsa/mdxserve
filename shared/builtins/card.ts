import type { ReactNode } from "react";
import { z } from "zod";

export const cardProps = z.object({
	title: z.string().optional().describe("Card heading."),
	description: z.string().optional().describe("One-sentence body text below the title."),
	icon: z.string().optional().describe("Lucide icon name shown above the title."),
	meta: z.string().optional().describe('Small uppercase mono line at the bottom, e.g. "3 pages".'),
	href: z.string().optional().describe("Renders the card as a link and enables the hover lift."),
	interactive: z.boolean().default(false).describe("Enables the hover lift without a link."),
	children: z
		.custom<ReactNode>()
		.optional()
		.describe("Extra content rendered below the description/meta."),
});

export type CardProps = z.infer<typeof cardProps>;

export const cardGridProps = z.object({
	columns: z
		.enum(["2", "3"])
		.default("2")
		.describe("Maximum columns at the widest breakpoint; fewer on narrower screens."),
	children: z.custom<ReactNode>().describe("One or more `<Card>` elements."),
});

export type CardGridProps = z.infer<typeof cardGridProps>;
