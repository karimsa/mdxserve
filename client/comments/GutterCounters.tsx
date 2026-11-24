import { useAtomValue } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { findArticle } from "./dom";
import type { CommentsModel, ThreadView } from "./model";
import { layoutPins, pinLeft, type PinAnchor } from "./pins";
import { activeThreadAtom } from "./state";

const PIN_HEIGHT = 22;
const PIN_WIDTH_ESTIMATE = 44;
const LINE_HEIGHT = 24;

interface Pin {
	id: string;
	top: number;
	left: number;
	count: number;
}

/** The first line of the thread's anchor, or the start of its block. */
function anchorLine(view: ThreadView): { top: number; height: number } | null {
	const rect = view.range?.getClientRects()[0];
	if (rect && (rect.width > 0 || rect.height > 0)) return { top: rect.top, height: rect.height };
	const block = view.scrollTarget?.getBoundingClientRect();
	if (!block) return null;
	return { top: block.top, height: Math.min(block.height, LINE_HEIGHT) };
}

/**
 * Small pills at the right edge of the doc column, level with each open
 * thread's anchor, showing its message count. Desktop with the sidebar closed
 * only; a click opens the popover.
 */
export function GutterCounters({ model }: { model: CommentsModel }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [pins, setPins] = useState<Pin[]>([]);
	const activeId = useAtomValue(activeThreadAtom);
	const { threads, views } = model;

	const measure = useCallback(() => {
		const origin = containerRef.current?.getBoundingClientRect();
		const article = findArticle();
		if (!origin || !article) {
			setPins([]);
			return;
		}
		const left = pinLeft(
			article.getBoundingClientRect().right,
			PIN_WIDTH_ESTIMATE,
			window.innerWidth,
		);
		const counts = new Map<string, number>();
		const anchors: PinAnchor[] = [];
		for (const thread of threads) {
			const view = thread.resolved ? undefined : views.get(thread.id);
			const line = view ? anchorLine(view) : null;
			if (!line) continue;
			counts.set(thread.id, thread.messages.length);
			anchors.push({ id: thread.id, top: line.top - origin.top, height: line.height });
		}
		setPins(
			layoutPins(anchors, PIN_HEIGHT, 4).map((placed) => ({
				id: placed.id,
				top: placed.top,
				left: left - origin.left,
				count: counts.get(placed.id) ?? 0,
			})),
		);
	}, [threads, views]);

	useLayoutEffect(measure, [measure]);

	// The doc reflows with the window, with late fonts and images, and with the
	// sidebar closing; anything that moves an anchor resizes the article. The
	// navigation sidebar and TOC rail shift the centred doc without resizing it,
	// but they do resize the content area around it.
	useEffect(() => {
		const article = findArticle();
		const contentArea = article?.closest("[data-content-area]") ?? null;
		const observer = article ? new ResizeObserver(measure) : null;
		if (article) observer?.observe(article);
		if (contentArea) observer?.observe(contentArea);
		window.addEventListener("resize", measure);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [measure]);

	return (
		<div ref={containerRef} data-print-hide className="pointer-events-none absolute top-0 left-0">
			{pins.map((pin) => (
				<button
					key={pin.id}
					type="button"
					data-comments-keep
					aria-label={`Open comment thread, ${pin.count} ${pin.count === 1 ? "message" : "messages"}`}
					onClick={() => model.showPopover(pin.id)}
					style={{ top: pin.top, left: pin.left, height: PIN_HEIGHT }}
					className={
						"pointer-events-auto absolute z-[1] inline-flex cursor-pointer items-center gap-1 rounded-full border px-[7px] font-sans text-[11.5px] leading-none font-semibold tabular-nums " +
						(pin.id === activeId
							? "border-border-strong bg-surface-hover text-text-heading"
							: "border-border-default bg-surface-card text-text-muted hover:text-text-heading")
					}
				>
					<Icon name="message-square" size={12} />
					{pin.count}
				</button>
			))}
		</div>
	);
}
