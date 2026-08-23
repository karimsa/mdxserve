import { useRef, type ReactNode, type RefObject } from "react";
import Tippy from "@tippyjs/react";
import { z } from "zod";

// tippy.js's base CSS is pulled in via client/app.css (`@import
// "tippy.js/dist/tippy.css"`) instead of a side-effect import here: this
// module is imported by scripts/build-registry.ts under plain Node (via
// tsx) to read `tooltipProps`, and a top-level `import "*.css"` there would
// crash with ERR_UNKNOWN_FILE_EXTENSION. Routing all CSS through app.css also
// matches how the rest of the app's styling is centralized.

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

export default function Tooltip({
	content,
	placement = "top",
	delay = 100,
	children,
}: TooltipProps) {
	// Attach via `reference` rather than wrapping a child element: @tippyjs/react
	// clones its child and reads `element.ref`, which React 19 warns about.
	const target = useRef<HTMLSpanElement>(null) as RefObject<HTMLSpanElement>;
	return (
		<>
			<span
				ref={target}
				tabIndex={0}
				className="cursor-help underline decoration-dotted decoration-gray-400 underline-offset-2"
			>
				{children}
			</span>
			<Tippy
				reference={target}
				content={content}
				placement={placement}
				delay={delay}
				theme="mdxserve"
				arrow
			/>
		</>
	);
}
