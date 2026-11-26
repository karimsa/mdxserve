import {
	AnimatePresence,
	animate,
	motion,
	useMotionValue,
	useReducedMotion,
	useTransform,
	type MotionValue,
	type Transition,
} from "framer-motion";
import {
	useEffect,
	useMemo,
	useRef,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import { useKeyboardInset } from "../hooks";
import { VARIANTS } from "../motion";
import { SHEET_DEFAULT_SNAP, settleSheet, sheetSnapHeights } from "./sheet-snap";

/** How much of the page stays visible above the sheet while the keyboard is open. */
const KEYBOARD_TOP_GAP = 72;

/** The same, for a sheet that takes all the room the keyboard leaves. */
const KEYBOARD_TOP_GAP_FILL = 8;

/** A press only becomes a drag past this many pixels, so taps on controls in the header still land. */
const DRAG_THRESHOLD = 6;

/** Rising and settling: loose enough to overshoot a little and come back. */
const SHEET_SPRING = { type: "spring", stiffness: 260, damping: 24, mass: 1 } satisfies Transition;

/** Leaving: no bounce on the way out. */
const SHEET_EXIT = { duration: 0.24, ease: [0.4, 0, 0.6, 1] } satisfies Transition;

/**
 * The sheet extends this far below the screen edge, so the spring's overshoot
 * on the way up shows more sheet instead of a gap under it.
 */
const SHEET_BLEED = 40;

export type SheetDragHandlers = {
	onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
	onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
	onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
	onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
};

type Drag = {
	pointerId: number;
	startY: number;
	startHeight: number;
	dragging: boolean;
	lastY: number;
	lastTime: number;
	velocity: number;
};

/** Dragging resizes the sheet between its snaps; dragged or tossed far enough down, it closes. */
function useSheetDrag(
	height: MotionValue<number>,
	onClose: () => void,
	dismissible: boolean,
): SheetDragHandlers {
	const reducedMotion = useReducedMotion();
	const drag = useRef<Drag | null>(null);

	return useMemo(() => {
		function release(event: ReactPointerEvent<HTMLElement>, settle: boolean) {
			const current = drag.current;
			if (!current || current.pointerId !== event.pointerId) return;
			drag.current = null;
			if (!current.dragging) return;
			const settled = settle
				? settleSheet(height.get(), current.velocity, window.innerHeight)
				: current.startHeight;
			// A sheet that may not close right now comes back to its lowest snap.
			const target =
				settled === "close" && !dismissible ? sheetSnapHeights(window.innerHeight)[0] : settled;
			if (target === "close") onClose();
			else if (reducedMotion) height.set(target);
			else animate(height, target, { ...SHEET_SPRING, velocity: current.velocity });
		}

		return {
			onPointerDown(event) {
				if (event.pointerType === "mouse" && event.button !== 0) return;
				height.stop();
				drag.current = {
					pointerId: event.pointerId,
					startY: event.clientY,
					startHeight: height.get(),
					dragging: false,
					lastY: event.clientY,
					lastTime: event.timeStamp,
					velocity: 0,
				};
			},
			onPointerMove(event) {
				const current = drag.current;
				if (!current || current.pointerId !== event.pointerId) return;
				const travelled = current.startY - event.clientY;
				if (!current.dragging) {
					if (Math.abs(travelled) < DRAG_THRESHOLD) return;
					current.dragging = true;
					event.currentTarget.setPointerCapture(event.pointerId);
				}
				const elapsed = event.timeStamp - current.lastTime;
				if (elapsed > 0) {
					current.velocity = ((current.lastY - event.clientY) / elapsed) * 1000;
					current.lastY = event.clientY;
					current.lastTime = event.timeStamp;
				}
				const tallest = sheetSnapHeights(window.innerHeight).at(-1) ?? window.innerHeight;
				height.set(Math.min(tallest, Math.max(0, current.startHeight + travelled)));
			},
			onPointerUp: (event) => release(event, true),
			onPointerCancel: (event) => release(event, false),
		};
	}, [height, onClose, dismissible, reducedMotion]);
}

/**
 * Phone-width panel that springs up from the bottom edge. Its grab handle (and
 * whatever the children spread the drag handlers onto, usually a header)
 * resizes it between snap heights; dragged or tossed down, it closes. It rides
 * above the on-screen keyboard. Hidden from `md` up.
 */
export function BottomSheet({
	open,
	onClose,
	onExitComplete,
	label,
	scrim = false,
	closeOnEscape = true,
	dismissible = true,
	fillAboveKeyboard = false,
	onClick,
	marker,
	children,
}: {
	open: boolean;
	onClose: () => void;
	/** Runs once the sheet has finished sliding away. */
	onExitComplete?: () => void;
	/** Accessible name of the panel. */
	label: string;
	/** Dims the page behind the sheet; tapping the dimmed page closes it. */
	scrim?: boolean;
	closeOnEscape?: boolean;
	/** False while the sheet has to stay: dragging it down settles it back instead of closing it. */
	dismissible?: boolean;
	/** With the keyboard open, grow to fill the screen above it instead of keeping the current size. */
	fillAboveKeyboard?: boolean;
	onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
	/** A `data-*` attribute other code finds the sheet by. */
	marker?: `data-${string}`;
	children: (dragHandlers: SheetDragHandlers) => ReactNode;
}) {
	// The sheet never grows taller than what the keyboard leaves visible (less
	// a strip of the page above it).
	const { inset, visibleHeight } = useKeyboardInset();
	const keyboardOpen = inset > 0 && visibleHeight !== null;
	const keyboardHeight = keyboardOpen
		? Math.max(
				160,
				visibleHeight - (fillAboveKeyboard ? KEYBOARD_TOP_GAP_FILL : KEYBOARD_TOP_GAP),
			) + SHEET_BLEED
		: 0;
	const height = useMotionValue(0);
	const paddedHeight = useTransform(height, (value) => value + SHEET_BLEED);
	const dragHandlers = useSheetDrag(height, onClose, dismissible);

	// Every opening starts from the default snap, whatever size it was dragged to last time.
	useEffect(() => {
		if (open) height.set(sheetSnapHeights(window.innerHeight)[SHEET_DEFAULT_SNAP]);
	}, [open, height]);

	// A rotated phone is a shorter screen: keep the handle and header on it.
	useEffect(() => {
		if (!open) return;
		function clamp() {
			const tallest = sheetSnapHeights(window.innerHeight).at(-1) ?? window.innerHeight;
			if (height.get() > tallest) height.set(tallest);
		}
		window.addEventListener("resize", clamp);
		return () => window.removeEventListener("resize", clamp);
	}, [open, height]);

	useEffect(() => {
		if (!open || !closeOnEscape) return;
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") onClose();
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, closeOnEscape, onClose]);

	return (
		<>
			{scrim ? (
				<AnimatePresence>
					{open ? (
						<motion.div
							key="sheet-scrim"
							data-print-hide
							{...VARIANTS.scrim}
							onClick={onClose}
							className="fixed inset-0 z-[var(--z-scrim)] bg-[var(--scrim)] md:hidden"
						/>
					) : null}
				</AnimatePresence>
			) : null}
			<AnimatePresence onExitComplete={onExitComplete}>
				{open ? (
					<motion.aside
						key="sheet"
						{...(marker ? { [marker]: "" } : {})}
						data-print-hide
						aria-label={label}
						initial={{ y: "100%" }}
						animate={{ y: 0 }}
						exit={{ y: "100%", transition: SHEET_EXIT }}
						transition={SHEET_SPRING}
						onClick={onClick}
						style={{
							bottom: inset - SHEET_BLEED,
							height: paddedHeight,
							paddingBottom: `calc(${SHEET_BLEED}px + env(safe-area-inset-bottom, 0px))`,
							maxHeight: keyboardOpen ? keyboardHeight : undefined,
							minHeight: keyboardOpen && fillAboveKeyboard ? keyboardHeight : undefined,
						}}
						className="fixed inset-x-0 z-[var(--z-modal)] flex flex-col overflow-hidden rounded-t-[16px] bg-surface-card shadow-lg transition-[bottom] duration-200 ease-out md:hidden"
					>
						<div
							aria-hidden
							data-sheet-handle
							{...dragHandlers}
							className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
						>
							<span className="h-1 w-9 rounded-full bg-border-strong" />
						</div>
						{children(dragHandlers)}
					</motion.aside>
				) : null}
			</AnimatePresence>
		</>
	);
}
