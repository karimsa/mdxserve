import { z } from "zod";

const size = z.number().positive().max(100_000);

/**
 * @internal Exported for its tests.
 *
 * What the diagram page (scripts/diagram-page/page.js) posts to the app. The page cuts the
 * strings to these lengths before posting, so a valid page never fails the schema.
 */
export const diagramMessageSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("ready") }),
	z.object({
		kind: z.literal("rendered"),
		token: z.number().int().nonnegative(),
		width: size,
		height: size,
		title: z.string().max(500).nullable(),
		description: z.string().max(2000).nullable(),
	}),
	z.object({ kind: z.literal("zoom"), scale: z.number().min(1).max(10) }),
	z.object({
		kind: z.literal("error"),
		token: z.number().int().nonnegative(),
		message: z.string().max(2000),
	}),
]);

export type DiagramMessage = z.infer<typeof diagramMessageSchema>;

/** The message in a WebView event's `data`, or null when it is not one. Never throws. */
export function parseDiagramMessage(data: unknown): DiagramMessage | null {
	if (typeof data !== "string") return null;
	let value: unknown;
	try {
		value = JSON.parse(data);
	} catch {
		return null;
	}
	const parsed = diagramMessageSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
