import { useRef, type RefObject } from "react";
import Tippy from "@tippyjs/react";
import { type TooltipProps } from "@mdxserve/shared/builtins/tooltip";

// tippy.js's base CSS and the `mdxserve` theme are in the web client's stylesheet
// (apps/web/src/app.css), so all of its styling goes through that one file. The app's
// tooltip is Tooltip.tsx.

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
