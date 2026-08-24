import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useSpring } from "framer-motion";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Kbd } from "./Kbd";
import { T, V } from "../motion";

export interface ExpandModalProps {
	open: boolean;
	onClose: () => void;
	/** Lucide icon shown before the title. */
	icon: string;
	title: string;
	/** Short interaction hint after the title, e.g. "Drag to pan · scroll to zoom". */
	hint?: ReactNode;
	/** Fills the panel below the header; render it `h-full` to take the whole area. */
	children: ReactNode;
}

/** Explicit panel size once the reader has dragged an edge; null = the default inset. */
interface PanelSize {
	width: number;
	height: number;
}

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_WIDTH = 480;
const MIN_HEIGHT = 320;
/** Smallest gap kept between the panel and the viewport while resizing. */
const MARGIN = 16;

// Grab strips are 10px wide, straddling the edge (5px out, 5px in); corners are 16px squares.
// Written as literal class strings so Tailwind's scanner can see them.
const EDGE_HANDLES: { edge: Edge; className: string; bar?: string }[] = [
	{
		edge: "n",
		className: "top-[-5px] right-4 left-4 h-[10px] cursor-ns-resize",
		bar: "top-[4px] right-0 left-0 h-[2px]",
	},
	{
		edge: "s",
		className: "bottom-[-5px] right-4 left-4 h-[10px] cursor-ns-resize",
		bar: "bottom-[4px] right-0 left-0 h-[2px]",
	},
	{
		edge: "e",
		className: "top-4 right-[-5px] bottom-4 w-[10px] cursor-ew-resize",
		bar: "top-0 right-[4px] bottom-0 w-[2px]",
	},
	{
		edge: "w",
		className: "top-4 bottom-4 left-[-5px] w-[10px] cursor-ew-resize",
		bar: "top-0 bottom-0 left-[4px] w-[2px]",
	},
	{ edge: "nw", className: "top-[-5px] left-[-5px] h-4 w-4 cursor-nwse-resize" },
	{ edge: "se", className: "right-[-5px] bottom-[-5px] h-4 w-4 cursor-nwse-resize" },
	{ edge: "ne", className: "top-[-5px] right-[-5px] h-4 w-4 cursor-nesw-resize" },
	{ edge: "sw", className: "bottom-[-5px] left-[-5px] h-4 w-4 cursor-nesw-resize" },
];

function clampSize(size: PanelSize, viewport: { width: number; height: number }): PanelSize {
	// The minimum is capped by what's available: on a window narrower or shorter
	// than the minimum the panel has to fit the viewport rather than overflow it
	// (which would push the close control off screen).
	const availableWidth = Math.max(0, viewport.width - MARGIN * 2);
	const availableHeight = Math.max(0, viewport.height - MARGIN * 2);
	const width = Math.min(Math.max(size.width, Math.min(MIN_WIDTH, availableWidth)), availableWidth);
	const height = Math.min(
		Math.max(size.height, Math.min(MIN_HEIGHT, availableHeight)),
		availableHeight,
	);
	return { width: Math.round(width), height: Math.round(height) };
}

/**
 * The panel stays centred while it resizes, so moving one edge by `d` changes
 * that dimension by `2d`. Each dimension is solved from the pointer's distance
 * to the panel centre (minus where on the strip it was grabbed) rather than
 * accumulated deltas, so a long drag can't drift.
 */
function resizeFromCentre(
	edge: Edge,
	pointer: { x: number; y: number },
	centre: { x: number; y: number },
	grab: { x: number; y: number },
	current: PanelSize,
	viewport: { width: number; height: number },
): PanelSize {
	let { width, height } = current;
	if (edge.includes("e")) width = 2 * (pointer.x - centre.x - grab.x);
	if (edge.includes("w")) width = 2 * (centre.x - pointer.x - grab.x);
	if (edge.includes("s")) height = 2 * (pointer.y - centre.y - grab.y);
	if (edge.includes("n")) height = 2 * (centre.y - pointer.y - grab.y);
	return clampSize({ width, height }, viewport);
}

/**
 * Near-full-screen modal for exploring a diagram or chart at a larger scale.
 * The panel takes the viewport minus a small inset by default; dragging any
 * edge or corner resizes it symmetrically so it stays centred (double-click a
 * handle, or reopen, to reset), and
 * `children` get the whole area under a slim header (icon, title, hint, close).
 */
export function ExpandModal({ open, onClose, icon, title, hint, children }: ExpandModalProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	// Whether the reader has taken over the size; the springs below hold it.
	const [custom, setCustom] = useState(false);
	const [dragging, setDragging] = useState<Edge | null>(null);
	// glide, not snap (as for the sidebar/toc widths): the panel trails the
	// cursor slightly so the spring is felt as it settles into shape.
	const widthSpring = useSpring(0, T.glide);
	const heightSpring = useSpring(0, T.glide);
	/** Latest un-animated target, so clamping on window resize starts from the real size. */
	const target = useRef<PanelSize | null>(null);
	const drag = useRef<{
		edge: Edge;
		centre: { x: number; y: number };
		/** Pointer distance past the grabbed edge at press time, so the edge doesn't snap under the cursor. */
		grab: { x: number; y: number };
	} | null>(null);

	// Document-level so Escape works wherever focus landed (a pan surface or
	// chart is a plain element and never holds focus itself).
	useEffect(() => {
		if (!open) return;
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
			}
		}
		document.addEventListener("keydown", onKeyDown);
		// Wheel-zooming the content must not also scroll the document behind the scrim.
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.body.style.overflow = previousOverflow;
			// A drag interrupted by closing (Escape, scrim click, unmount) never sees
			// pointerup, so release its global state here: otherwise text selection
			// stays disabled page-wide and the next open treats a hover over a handle
			// as an in-progress drag.
			drag.current = null;
			setDragging(null);
			document.body.style.userSelect = "";
		};
	}, [open, onClose]);

	// A custom size lasts for one viewing: reopening starts from the default inset.
	const resetSize = useCallback(() => {
		target.current = null;
		setCustom(false);
	}, []);

	useEffect(() => {
		if (!open) resetSize();
	}, [open, resetSize]);

	// Keep a custom size inside the window if the window shrinks underneath it.
	useEffect(() => {
		if (!custom) return;
		function onResize() {
			if (!target.current) return;
			const next = clampSize(target.current, {
				width: window.innerWidth,
				height: window.innerHeight,
			});
			target.current = next;
			widthSpring.set(next.width);
			heightSpring.set(next.height);
		}
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [custom, widthSpring, heightSpring]);

	const onHandleDown = useCallback(
		(edge: Edge, event: React.PointerEvent<HTMLDivElement>) => {
			const panel = panelRef.current;
			if (!panel) return;
			event.preventDefault();
			const bounds = panel.getBoundingClientRect();
			const centre = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
			const grab = {
				x: edge.includes("e")
					? event.clientX - bounds.right
					: edge.includes("w")
						? bounds.left - event.clientX
						: 0,
				y: edge.includes("s")
					? event.clientY - bounds.bottom
					: edge.includes("n")
						? bounds.top - event.clientY
						: 0,
			};
			drag.current = { edge, centre, grab };
			// Land the springs on what's on screen (no animating up from 0) before
			// the panel switches to the explicit, spring-driven size.
			target.current = { width: bounds.width, height: bounds.height };
			widthSpring.jump(bounds.width);
			heightSpring.jump(bounds.height);
			setCustom(true);
			setDragging(edge);
			try {
				event.currentTarget.setPointerCapture(event.pointerId);
			} catch {
				// Not a live pointer (synthetic event); the drag still works while the cursor stays on the handle.
			}
			document.body.style.userSelect = "none";
		},
		[widthSpring, heightSpring],
	);

	const onHandleMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const current = drag.current;
			if (!current) return;
			const next = resizeFromCentre(
				current.edge,
				{ x: event.clientX, y: event.clientY },
				current.centre,
				current.grab,
				target.current ?? { width: MIN_WIDTH, height: MIN_HEIGHT },
				{ width: window.innerWidth, height: window.innerHeight },
			);
			target.current = next;
			widthSpring.set(next.width);
			heightSpring.set(next.height);
		},
		[widthSpring, heightSpring],
	);

	const onHandleUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		if (!drag.current) return;
		drag.current = null;
		setDragging(null);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		document.body.style.userSelect = "";
	}, []);

	// The SSR entry renders the same component tree; never touch `document` at
	// render time there (the modal is only ever opened client-side anyway).
	if (typeof document === "undefined") return null;

	// Portal to <body>: callers sit inside the route wrapper, whose fadeRise
	// transform would otherwise turn `fixed` into "fixed to the column" and let
	// the scrim miss the top bar and sidebar.
	return createPortal(
		<AnimatePresence>
			{open ? (
				<motion.div
					key="scrim"
					onClick={onClose}
					{...V.scrim}
					className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--scrim)] p-4 backdrop-blur-sm sm:p-8"
				>
					<motion.div
						ref={panelRef}
						onClick={(event) => event.stopPropagation()}
						{...V.pop}
						role="dialog"
						aria-modal="true"
						aria-label={`Expanded ${title.toLowerCase()}`}
						// Once an edge has been dragged the panel takes an explicit size and stays
						// centred by the scrim's flex box; until then it fills the padded area
						// (capped for very wide windows).
						style={
							custom
								? { width: widthSpring, height: heightSpring, maxWidth: "none", flex: "none" }
								: undefined
						}
						className="relative flex h-full w-full max-w-[1600px] flex-col rounded-xl border border-border-default bg-surface-raised shadow-lg"
					>
						<div className="flex shrink-0 items-center gap-2 rounded-t-xl border-b border-border-subtle px-3 py-2">
							<Icon name={icon} size="md" className="text-text-muted" />
							<span className="font-sans font-semibold text-text-heading text-[length:var(--size-sm)]">
								{title}
							</span>
							<span className="hidden items-center gap-1.5 font-sans text-[length:var(--size-xs)] text-text-subtle sm:flex">
								{hint ? <>{hint} · </> : null}
								drag an edge to resize · <Kbd>esc</Kbd> to close
							</span>
							<IconButton
								icon="x"
								label="Close"
								size="md"
								autoFocus
								onClick={onClose}
								className="ml-auto"
							/>
						</div>
						<div className="min-h-0 flex-1 overflow-hidden rounded-b-xl">{children}</div>
						{EDGE_HANDLES.map(({ edge, className, bar }) => (
							<div
								key={edge}
								role="separator"
								aria-label={`Resize ${edge} edge`}
								className={"group absolute z-10 " + className}
								onPointerDown={(event) => onHandleDown(edge, event)}
								onPointerMove={onHandleMove}
								onPointerUp={onHandleUp}
								onPointerCancel={onHandleUp}
								onDoubleClick={resetSize}
							>
								{bar ? (
									<span
										className={
											"absolute rounded-full transition-opacity " +
											bar +
											(dragging === edge
												? " bg-surface-accent opacity-100"
												: " bg-border-default opacity-0 group-hover:opacity-100")
										}
									/>
								) : null}
							</div>
						))}
					</motion.div>
				</motion.div>
			) : null}
		</AnimatePresence>,
		document.body,
	);
}
