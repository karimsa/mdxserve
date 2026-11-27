import { z } from "zod";
import { statefulIdProp } from "./id";

export const diffProps = z.object({
	id: statefulIdProp,
	before: z.string().describe("Original text."),
	after: z.string().describe("New text."),
	language: z
		.string()
		.optional()
		.describe(
			"Label only, shown in the header when `title` isn't set. Shown as a label; the diff is colored by " +
				"change, not by syntax — Shiki highlights fenced code blocks in the browser, not the strings " +
				"passed to this component.",
		),
	title: z
		.string()
		.optional()
		.describe("Filename or heading shown in the header; takes precedence over `language`."),
	view: z.enum(["unified", "split"]).default("unified").describe("Initial view."),
	context: z
		.number()
		.int()
		.min(0)
		.default(3)
		.describe(
			"Unchanged lines kept around each change; longer unchanged runs collapse into an expandable separator.",
		),
});

export type DiffProps = z.infer<typeof diffProps>;
