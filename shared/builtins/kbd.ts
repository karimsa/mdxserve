import type { ReactNode } from "react";
import { z } from "zod";

export const kbdProps = z.object({
	children: z
		.custom<ReactNode>()
		.describe("Key label, e.g. a letter, `esc`, or a unicode symbol such as `⌘`."),
});

export type KbdProps = z.infer<typeof kbdProps>;
