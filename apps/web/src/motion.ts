import type { Transition, Variants } from "framer-motion";
import { DURATIONS, SPRINGS } from "@mdxserve/ui/tokens/springs";

/** Shared ease for every subtle motion in the app: a gentle deceleration. */
const subtleEase = [0.22, 1, 0.36, 1] as const;

export const enterTransition: Transition = { duration: 0.2, ease: subtleEase };
const exitTransition: Transition = { duration: 0.15, ease: subtleEase };
export const fadeSwapTransition: Transition = { duration: 0.12, ease: subtleEase };

/**
 * Fade + slight vertical rise. Used for page-level view transitions (App.tsx)
 * and card-level entrances (CodeFrame, Callout).
 */
export const fadeRise: Variants = {
	initial: { opacity: 0, y: 8 },
	enter: { opacity: 1, y: 0, transition: enterTransition },
	exit: { opacity: 0, y: -6, transition: exitTransition },
};

/** Stagger container for groups of items that should enter together (listing rows). */
export const stagger: Variants = {
	initial: {},
	enter: { transition: { staggerChildren: 0.02 } },
};

/* ── Design-system motion (mirrors apps/web/src/design-ref/components/motion/MotionKit.jsx
   and the --spring-* / --dur-* tokens in client/design/tokens/motion.css).
   Springs for anything physical, tweens for colour and opacity only. Nothing
   overshoots past 2%, nothing travels more than 10px. ── */

export const TRANSITIONS = {
	/** Controls: press, toggle knobs, segmented pills. 1:1 with --spring-snap. */
	snap: { type: "spring", ...SPRINGS.snap } satisfies Transition,
	/** Surfaces: dialogs, toasts, disclosure. 1:1 with --spring-glide. */
	glide: { type: "spring", ...SPRINGS.glide } satisfies Transition,
	/** Colour and opacity only. */
	fast: { duration: DURATIONS.fast / 1000, ease: [0.2, 0, 0.2, 1] } satisfies Transition,
	base: { duration: DURATIONS.base / 1000, ease: [0.2, 0, 0.2, 1] } satisfies Transition,
	slow: { duration: 0.26, ease: [0, 0, 0.2, 1] } satisfies Transition,
};

type Entrance = {
	initial: Record<string, number | string>;
	animate: Record<string, number | string>;
	exit?: Record<string, number | string | Transition>;
	transition: Transition;
};

/** Named entrances, so every surface of the same class enters identically. Spread onto a `motion.*`. */
export const VARIANTS = {
	/** Tooltips, inline swaps: opacity only. */
	fade: {
		initial: { opacity: 0 },
		animate: { opacity: 1 },
		exit: { opacity: 0 },
		transition: TRANSITIONS.base,
	},
	/** Dialogs and the search palette. */
	pop: {
		initial: { opacity: 0, y: 6, scale: 0.985 },
		animate: { opacity: 1, y: 0, scale: 1 },
		exit: { opacity: 0, y: 4, scale: 0.99, transition: TRANSITIONS.fast },
		transition: TRANSITIONS.glide,
	},
	/** Toasts, from the bottom-right stack. */
	slideUp: {
		initial: { opacity: 0, y: 10, scale: 0.98 },
		animate: { opacity: 1, y: 0, scale: 1 },
		exit: { opacity: 0, x: 16, transition: TRANSITIONS.fast },
		transition: TRANSITIONS.glide,
	},
	/** Scrims behind a modal surface. */
	scrim: {
		initial: { opacity: 0 },
		animate: { opacity: 1 },
		exit: { opacity: 0 },
		transition: TRANSITIONS.fast,
	},
	/** Collapsible nav groups and diagram/code swaps. */
	collapse: {
		initial: { opacity: 0, height: 0 },
		animate: { opacity: 1, height: "auto" },
		exit: { opacity: 0, height: 0 },
		transition: TRANSITIONS.glide,
	},
	/** Page and section content, 6px up. */
	rise: {
		initial: { opacity: 0, y: 6 },
		animate: { opacity: 1, y: 0 },
		transition: TRANSITIONS.glide,
	},
} satisfies Record<string, Entrance>;
