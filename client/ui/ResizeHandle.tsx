import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { T } from "../motion";

/** Gap between the content's edge and the resize handle's resting line. */
const HANDLE_INSET = 12;
/** Hover zone width: covers the inset gap plus room on either side of the line. */
const HANDLE_ZONE = 40;

type HandleState = "idle" | "hover" | "drag";

const handleBar: Record<
	HandleState,
	{ width: number; height: string; opacity: number; backgroundColor: string }
> = {
	// A short muted pill at rest, so the affordance is discoverable.
	idle: { width: 3, height: "40px", opacity: 0.6, backgroundColor: "var(--border-default)" },
	// Full-height line on hover.
	hover: { width: 2, height: "100%", opacity: 1, backgroundColor: "var(--border-default)" },
	// Thicker and teal while dragging.
	drag: { width: 4, height: "100%", opacity: 1, backgroundColor: "var(--surface-accent)" },
};

/**
 * Resize handle just outside one edge of a centred content block. The hover
 * zone is wide (it spans the inset gap) so it's easy to find; the bar itself
 * rests as a short pill, grows to a full-height line on hover, and thickens +
 * turns teal mid-drag. The content is centred in the area marked with
 * `data-content-area`, so moving one edge by `d` changes the width by `2d` —
 * computed from the content's centre rather than accumulated deltas so the
 * drag can't drift. Widths are clamped to [minWidth, maxWidth] and to the
 * content area so the block never runs under the surrounding chrome.
 */
export function ResizeHandle({
	side,
	container,
	onResize,
	label,
	minWidth,
	maxWidth,
}: {
	side: "left" | "right";
	container: React.RefObject<HTMLDivElement | null>;
	onResize: (width: number) => void;
	label: string;
	minWidth: number;
	maxWidth: number;
}) {
	const [hovered, setHovered] = useState(false);
	const [dragging, setDragging] = useState(false);
	const draggingRef = useRef(false);
	/** Pointer distance from the resting bar at grab time, so a press anywhere
	 * in the zone drags relative to it instead of snapping the bar under the cursor. */
	const grabOffset = useRef(0);

	useEffect(() => {
		return () => {
			if (!draggingRef.current) return;
			draggingRef.current = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
	}, []);

	const clamp = useCallback(
		(px: number) => {
			const area = container.current?.closest("[data-content-area]");
			const available = area instanceof HTMLElement ? area.clientWidth : maxWidth;
			return Math.min(Math.min(maxWidth, available), Math.max(minWidth, Math.round(px)));
		},
		[container, minWidth, maxWidth],
	);

	const onPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			if (container.current) {
				const rect = container.current.getBoundingClientRect();
				const centre = rect.left + rect.width / 2;
				const half = side === "right" ? event.clientX - centre : centre - event.clientX;
				grabOffset.current = half - (rect.width / 2 + HANDLE_INSET);
			} else {
				grabOffset.current = 0;
			}
			draggingRef.current = true;
			setDragging(true);
			try {
				event.currentTarget.setPointerCapture(event.pointerId);
			} catch {
				// Not a live pointer (synthetic event); the drag still works while the cursor stays in the zone.
			}
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
		},
		[container, side],
	);

	const onPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!draggingRef.current || !container.current) return;
			const rect = container.current.getBoundingClientRect();
			const centre = rect.left + rect.width / 2;
			const half = side === "right" ? event.clientX - centre : centre - event.clientX;
			onResize(clamp((half - HANDLE_INSET - grabOffset.current) * 2));
		},
		[container, onResize, side, clamp],
	);

	const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		draggingRef.current = false;
		setDragging(false);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
	}, []);

	const state: HandleState = dragging ? "drag" : hovered ? "hover" : "idle";
	// Centre the bar on the inset line: the zone starts at the content edge and
	// extends outward, so the line sits HANDLE_INSET in from the zone's inner edge.
	const zoneStyle =
		side === "right"
			? { right: -HANDLE_ZONE, paddingLeft: HANDLE_INSET }
			: { left: -HANDLE_ZONE, paddingRight: HANDLE_INSET };

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={label}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			style={{ width: HANDLE_ZONE, ...zoneStyle }}
			className={
				"absolute inset-y-0 z-10 flex cursor-col-resize items-center " +
				(side === "right" ? "justify-start" : "justify-end")
			}
		>
			<motion.div
				initial={false}
				animate={handleBar[state]}
				transition={{ ...T.snap, opacity: T.fast, backgroundColor: T.fast }}
				className="shrink-0 rounded-full"
			/>
		</div>
	);
}
