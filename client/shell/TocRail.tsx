import { useAtom, useAtomValue } from "jotai";
import { useRef } from "react";
import { ResizeHandle } from "../ui/ResizeHandle";
import { TocList } from "../ui/TocList";
import { TOC_MAX_WIDTH, TOC_MIN_WIDTH, tocVisibleAtom, tocWidthAtom } from "../state";
import { useToc } from "./useToc";

function clampWidth(px: number): number {
	return Math.min(TOC_MAX_WIDTH, Math.max(TOC_MIN_WIDTH, Math.round(px)));
}

/** "On this page" rail. Hidden entirely when the doc has no h2s. */
export function TocRail({ path, version }: { path: string; version: number }) {
	const { items, activeId, setActiveId } = useToc(path, version);
	const [width, setWidth] = useAtom(tocWidthAtom);
	const visible = useAtomValue(tocVisibleAtom);
	const railRef = useRef<HTMLDivElement>(null);
	const hasH2 = items.some((item) => item.level === 2);
	if (!visible || !hasH2) return null;

	function handleSelect(id: string) {
		setActiveId(id);
		history.replaceState(null, "", `#${id}`);
		document.getElementById(id)?.scrollIntoView({ block: "start" });
	}

	return (
		<div
			ref={railRef}
			data-print-hide
			className="hidden xl:block shrink-0 self-start ml-10 sticky top-[calc(var(--topbar-height)+40px)]"
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
				<TocList items={items} activeId={activeId} onSelect={handleSelect} />
			</div>
		</div>
	);
}
