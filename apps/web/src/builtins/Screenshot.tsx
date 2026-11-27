import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import SharedScreenshot from "@mdxserve/ui/builtins/Screenshot";
import { motion } from "framer-motion";
import { TRANSITIONS } from "../motion";
import { IconButton } from "../ui/IconButton";
import { ExpandModal } from "../ui/ExpandModal";
import { type ScreenshotProps } from "@mdxserve/shared/builtins/screenshot";

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
/** Zoom factor per +/− press; wheel zoom scales continuously with the delta. */
const ZOOM_STEP = 1.25;

interface View {
	scale: number;
	x: number;
	y: number;
}

const FIT_VIEW: View = { scale: 1, x: 0, y: 0 };

function clampScale(scale: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Zoom `view` by `factor` keeping the viewport point `focus` (relative to
 * the viewport centre) fixed under the cursor. The image is translated then
 * scaled about its centre, so a point `p` on it lands at `x + scale * p`.
 */
function zoomAt(view: View, factor: number, focus: { x: number; y: number }): View {
	const scale = clampScale(view.scale * factor);
	const ratio = scale / view.scale;
	return {
		scale,
		x: focus.x - (focus.x - view.x) * ratio,
		y: focus.y - (focus.y - view.y) * ratio,
	};
}

/**
 * Fills its parent with the image fitted to the available area at rest;
 * drag to pan, wheel to zoom about the cursor, double-click to reset, with
 * +/−/reset controls in the corner like the mermaid diagram viewport.
 */
function PanZoomImage({ src, alt }: { src: string; alt: string }) {
	const hostRef = useRef<HTMLDivElement>(null);
	const [view, setView] = useState<View>(FIT_VIEW);
	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		origin: View;
	} | null>(null);

	const reset = useCallback(() => setView(FIT_VIEW), []);
	const zoomBy = useCallback(
		(factor: number) => setView((current) => zoomAt(current, factor, { x: 0, y: 0 })),
		[],
	);

	// Wheel zoom has to preventDefault so the page behind the modal doesn't
	// scroll, and React registers wheel listeners as passive — so attach it by
	// hand.
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			const rect = host.getBoundingClientRect();
			const focus = {
				x: event.clientX - (rect.left + rect.width / 2),
				y: event.clientY - (rect.top + rect.height / 2),
			};
			const factor = Math.exp(-event.deltaY * 0.002);
			setView((current) => zoomAt(current, factor, focus));
		};
		host.addEventListener("wheel", onWheel, { passive: false });
		return () => host.removeEventListener("wheel", onWheel);
	}, []);

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			origin: view,
		};
	};
	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		setView({
			scale: drag.origin.scale,
			x: drag.origin.x + (event.clientX - drag.startX),
			y: drag.origin.y + (event.clientY - drag.startY),
		});
	};
	const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
		if (dragRef.current?.pointerId !== event.pointerId) return;
		dragRef.current = null;
		event.currentTarget.releasePointerCapture(event.pointerId);
	};

	return (
		<div className="relative h-full bg-surface-sunken">
			<div
				ref={hostRef}
				className="flex h-full w-full cursor-grab touch-none select-none items-center justify-center overflow-hidden active:cursor-grabbing"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onDoubleClick={reset}
			>
				<img
					src={src}
					alt={alt}
					draggable={false}
					className="max-h-full max-w-full"
					style={{
						transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
						transformOrigin: "center",
					}}
				/>
			</div>
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ ...TRANSITIONS.base, delay: 0.1 }}
				className="absolute right-3 bottom-3 flex flex-col divide-y divide-border-subtle overflow-hidden rounded-md border border-border-default bg-surface-card shadow-xs"
			>
				<IconButton icon="plus" label="Zoom in" size="sm" onClick={() => zoomBy(ZOOM_STEP)} />
				<IconButton icon="maximize" label="Reset view" size="sm" onClick={reset} />
				<IconButton icon="minus" label="Zoom out" size="sm" onClick={() => zoomBy(1 / ZOOM_STEP)} />
			</motion.div>
		</div>
	);
}

/**
 * The shared `Screenshot` (@mdxserve/ui) with the web client's full-screen view: its expand
 * modal around a pan-and-zoom image.
 */
export default function Screenshot(props: ScreenshotProps) {
	return (
		<SharedScreenshot
			{...props}
			renderExpanded={({ open, onClose, src, alt, title }) => (
				<ExpandModal
					open={open}
					onClose={onClose}
					icon="image"
					title={title || alt || "Screenshot"}
					hint="Drag to pan · scroll to zoom"
				>
					<PanZoomImage src={src} alt={alt} />
				</ExpandModal>
			)}
		/>
	);
}
