import { useRef, type RefObject } from "react";
import Tippy from "@tippyjs/react";
import { type TooltipProps } from "@mdxserve/shared/builtins/tooltip";

// tippy.js's base CSS is pulled in via apps/web/src/app.css (`@import
// "tippy.js/dist/tippy.css"`) instead of a side-effect import here, so all of the
// app's styling goes through that one stylesheet.

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
				className="cursor-help underline decoration-dotted decoration-text-subtle underline-offset-2"
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
