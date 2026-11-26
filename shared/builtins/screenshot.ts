import { z } from "zod";
import { statefulIdProp } from "./id";

export const screenshotProps = z.object({
	id: statefulIdProp,
	src: z.string().describe("Image URL, relative to the document like a Markdown image."),
	alt: z.string().default("").describe("Accessible description of the image."),
	title: z
		.string()
		.optional()
		.describe("Window title shown centred in the title bar, e.g. the app or page name."),
	caption: z.string().optional().describe("Caption shown below the image on a hairline rule."),
	width: z
		.union([z.number(), z.string()])
		.optional()
		.describe("Max width of the window (px or any CSS length); defaults to the full column."),
});

export type ScreenshotProps = z.infer<typeof screenshotProps>;
