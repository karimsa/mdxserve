import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { TRANSITIONS } from "../motion";
import { IconButton } from "../ui/IconButton";
import { ExpandModal } from "../ui/ExpandModal";

export const screenshotProps = z.object({
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

// macOS traffic-light colours; the same in both themes, like the real thing.
const TRAFFIC_LIGHTS = ["#ff5f57", "#febc2e", "#28c840"];

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

export default function Screenshot({ src, alt = "", title, caption, width }: ScreenshotProps) {
	const [expanded, setExpanded] = useState(false);

	return (
		<figure
			className="not-prose mx-auto overflow-hidden rounded-lg border border-border-default bg-surface-card shadow-md"
			style={width === undefined ? undefined : { maxWidth: width }}
		>
			<div className="relative flex h-[34px] items-center border-b border-border-subtle bg-surface-raised px-3">
				<div className="flex items-center gap-2" aria-hidden="true">
					{TRAFFIC_LIGHTS.map((color) => (
						<span
							key={color}
							className="block size-3 rounded-full border border-black/10"
							style={{ backgroundColor: color }}
						/>
					))}
				</div>
				{title ? (
					<span className="pointer-events-none absolute inset-x-16 truncate text-center font-sans font-medium leading-[1.62] text-[length:var(--size-xs)] text-text-subtle">
						{title}
					</span>
				) : null}
				<IconButton
					icon="expand"
					label="Expand screenshot"
					size="sm"
					className="-mr-1 ml-auto"
					onClick={() => setExpanded(true)}
				/>
			</div>
			<img src={src} alt={alt} className="block w-full" />
			{caption ? (
				<figcaption className="border-t border-border-subtle px-4 py-2.5 font-sans font-medium leading-normal text-[length:var(--size-xs)] text-text-subtle">
					{caption}
				</figcaption>
			) : null}
			<ExpandModal
				open={expanded}
				onClose={() => setExpanded(false)}
				icon="image"
				title={title || alt || "Screenshot"}
				hint="Drag to pan · scroll to zoom"
			>
				<PanZoomImage src={src} alt={alt} />
			</ExpandModal>
		</figure>
	);
}
