import { motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { TRANSITIONS } from "../motion";

/** Gap between the content's edge and the resize handle's resting line. */
const HANDLE_INSET = 12;
/** Hover zone width: covers the inset gap plus room on either side of the line. */
const HANDLE_ZONE = 40;
/** Height of the resting pill. */
const PILL_HEIGHT = 40;

type HandleState = "idle" | "hover" | "drag";

const handleBar: Record<
	HandleState,
	{ width: number; height: string; opacity: number; backgroundColor: string }
> = {
	// A short muted pill at rest, so the affordance is discoverable.
	idle: {
		width: 3,
		height: `${PILL_HEIGHT}px`,
		opacity: 0.6,
		backgroundColor: "var(--border-default)",
	},
	// Full-height line on hover.
	hover: { width: 2, height: "100%", opacity: 1, backgroundColor: "var(--border-default)" },
	// Thicker and teal while dragging.
	drag: { width: 4, height: "100%", opacity: 1, backgroundColor: "var(--surface-accent)" },
};

/**
 * Resize handle just outside one edge of a content block. The hover zone is
 * wide (it spans the inset gap) so it's easy to find; the bar itself rests as
 * a short pill, grows to a full-height line on hover, and thickens + turns
 * teal mid-drag. For a page-height content block the pill sticks to the
 * viewport's vertical centre (rather than the block's, which is usually off
 * screen) so it's always in view; anchored panels are already viewport-bound,
 * so theirs is simply centred.
 *
 * Two modes:
 * - Default: the content is centred in the area marked with
 *   `data-content-area`, so moving one edge by `d` changes the width by `2d` —
 *   computed from the content's centre rather than accumulated deltas so the
 *   drag can't drift. Widths are clamped to [minWidth, maxWidth] and to the
 *   content area so the block never runs under the surrounding chrome.
 * - `anchored`: the panel is flush against one edge of the layout (the docked
 *   sidebar on the left with `side="right"`, the toc rail on the right with
 *   `side="left"`), so the dragged edge maps 1:1 to the width with no doubling
 *   or centring, and the width is only clamped to [minWidth, maxWidth].
 */
export function ResizeHandle({
	side,
	container,
	onResize,
	label,
	minWidth,
	maxWidth,
	anchored = false,
}: {
	side: "left" | "right";
	container: React.RefObject<HTMLDivElement | null>;
	onResize: (width: number) => void;
	label: string;
	minWidth: number;
	maxWidth: number;
	/** Panel flush against the layout edge opposite `side`, so the drag maps 1:1 to the width. */
	anchored?: boolean;
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
			// Anchored panels aren't centred in a content area — clamp to the
			// configured bounds only.
			if (anchored) return Math.min(maxWidth, Math.max(minWidth, Math.round(px)));
			const area = container.current?.closest("[data-content-area]");
			const available = area instanceof HTMLElement ? area.clientWidth : maxWidth;
			return Math.min(Math.min(maxWidth, available), Math.max(minWidth, Math.round(px)));
		},
		[container, minWidth, maxWidth, anchored],
	);

	const onPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			if (anchored && container.current) {
				// Pointer distance past the panel's dragged edge, so the drag stays
				// relative to where it was grabbed instead of snapping the edge to the cursor.
				const rect = container.current.getBoundingClientRect();
				grabOffset.current =
					side === "right" ? event.clientX - rect.right : rect.left - event.clientX;
			} else if (container.current) {
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
		[container, side, anchored],
	);

	const onPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!draggingRef.current || !container.current) return;
			if (anchored) {
				const rect = container.current.getBoundingClientRect();
				const edge = side === "right" ? event.clientX - rect.left : rect.right - event.clientX;
				onResize(clamp(edge - grabOffset.current));
				return;
			}
			const rect = container.current.getBoundingClientRect();
			const centre = rect.left + rect.width / 2;
			const half = side === "right" ? event.clientX - centre : centre - event.clientX;
			onResize(clamp((half - HANDLE_INSET - grabOffset.current) * 2));
		},
		[container, onResize, side, clamp, anchored],
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
	// The left-anchored sidebar sits flush beside the main column, so rather than
	// overhang into it the zone straddles the panel's border, centred on it. The
	// right-anchored toc rail has a gutter on its left and its list draws its own
	// left border, so its bar sits out in the gutter like the centred handles.
	const zoneStyle =
		anchored && side === "right"
			? { right: -HANDLE_ZONE / 2 }
			: side === "right"
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
				"absolute inset-y-0 z-10 hidden md:flex cursor-col-resize " +
				(anchored
					? "items-center " + (side === "right" ? "justify-center" : "justify-end")
					: // A column so the sticky pill can slide along the zone's full height.
						"flex-col " + (side === "right" ? "items-start" : "items-end"))
			}
		>
			<motion.div
				initial={false}
				animate={handleBar[state]}
				transition={{
					...TRANSITIONS.snap,
					opacity: TRANSITIONS.fast,
					backgroundColor: TRANSITIONS.fast,
				}}
				className={"shrink-0 rounded-full" + (anchored ? "" : " sticky")}
				style={anchored ? undefined : { top: `calc(50vh - ${PILL_HEIGHT / 2}px)` }}
			/>
		</div>
	);
}
