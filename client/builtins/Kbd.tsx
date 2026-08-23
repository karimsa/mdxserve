import type { ReactNode } from "react";
import { z } from "zod";

export const kbdProps = z.object({
	children: z
		.custom<ReactNode>()
		.describe("Key label, e.g. a letter, `esc`, or a unicode symbol such as `⌘`."),
});

export type KbdProps = z.infer<typeof kbdProps>;

export default function Kbd({ children }: KbdProps) {
	return (
		<kbd className="not-prose inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-b-2 border-border-default bg-surface-card px-1.5 font-mono leading-[1.62] text-[length:var(--size-2xs)] font-medium text-text-muted">
			{children}
		</kbd>
	);
}
