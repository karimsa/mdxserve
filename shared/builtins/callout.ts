import type { ReactNode } from "react";
import { z } from "zod";

export const calloutProps = z.object({
	tone: z
		.enum(["note", "tip", "ok", "warn", "danger"])
		.default("note")
		.describe(
			"Visual intent and icon: note (info), tip (lightbulb), ok (success), warn (caution), or danger (breaking).",
		),
	type: z
		.enum(["info", "warn"])
		.optional()
		.describe("Deprecated alias for `tone` (info→note, warn→warn). Prefer `tone`."),
	title: z
		.string()
		.optional()
		.describe("Optional bold heading shown above the body; defaults to the tone's label."),
	children: z.custom<ReactNode>().describe("Callout body; any MDX/Markdown content."),
});

export type CalloutProps = z.infer<typeof calloutProps>;
