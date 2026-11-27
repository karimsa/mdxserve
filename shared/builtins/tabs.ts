import type { ReactNode } from "react";
import { z } from "zod";
import { statefulIdProp } from "./id";

export const tabProps = z.object({
	label: z.string().describe("Tab label shown in the tab list."),
	value: z
		.string()
		.optional()
		.describe("Stable identifier for this tab; defaults to a slug of `label`."),
	children: z.custom<ReactNode>().describe("Tab panel content; any MDX/Markdown content."),
});

export type TabProps = z.infer<typeof tabProps>;

export const tabsProps = z.object({
	id: statefulIdProp,
	defaultValue: z
		.string()
		.optional()
		.describe("Value of the tab selected initially; defaults to the first tab."),
	children: z.custom<ReactNode>().describe("One or more `<Tab>` elements."),
});

/** The `value` a tab gets when it has none: its label, lowercased, with each run of other characters turned into `-`. */
export function tabValueFromLabel(label: string): string {
	return label
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
}
