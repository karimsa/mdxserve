import { useAtom } from "jotai";
import { useRef } from "react";
import { ResizeHandle } from "../ui/ResizeHandle";
import { TocList } from "../ui/TocList";
import { TOC_MAX_WIDTH, TOC_MIN_WIDTH, tocWidthAtom } from "../state";
import type { DocToc } from "./useDocToc";

function clampWidth(px: number): number {
	return Math.min(TOC_MAX_WIDTH, Math.max(TOC_MIN_WIDTH, Math.round(px)));
}

/** "On this page" rail beside the doc. Renders nothing when the mode or the doc has no rail. */
export function TocRail({ toc }: { toc: DocToc }) {
	const [width, setWidth] = useAtom(tocWidthAtom);
	const railRef = useRef<HTMLDivElement>(null);
	if (toc.rail === null) return null;

	return (
		<div
			ref={railRef}
			data-toc-rail
			data-print-hide
			className={
				toc.rail + " shrink-0 self-start ml-10 sticky top-[calc(var(--topbar-height)+40px)]"
			}
			style={{ width: clampWidth(width) }}
		>
			{/* The rail is flush against the main column's right edge, so the
			    handle sits on its left and the drag maps 1:1 to the width. It's a
			    sibling of the scroller, not inside it, so overflow-y-auto can't clip it. */}
			<ResizeHandle
				side="left"
				anchored
				container={railRef}
				onResize={setWidth}
				label="Resize table of contents"
				minWidth={TOC_MIN_WIDTH}
				maxWidth={TOC_MAX_WIDTH}
			/>
			{/* Capped to the viewport (less the sticky offset and matching bottom
			    margin) so a long list scrolls here instead of running below the fold,
			    and the handle's resting pill stays centred in what's visible. */}
			<div className="max-h-[calc(100vh-var(--topbar-height)-80px)] overflow-y-auto">
				<TocList items={toc.items} activeId={toc.activeId} onSelect={toc.select} />
			</div>
		</div>
	);
}
