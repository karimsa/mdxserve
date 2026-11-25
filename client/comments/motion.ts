import type { Transition } from "framer-motion";
import { TRANSITIONS } from "../motion";

const INSTANT: Transition = { duration: 0 };

/**
 * A row that makes room for itself: threads in the panel and messages in a
 * thread. The element needs `overflow-hidden`, and its spacing has to be
 * padding inside it, or the list jumps by the margin when the row appears.
 * With reduced motion the height change is instant and only the fade remains.
 */
export function rowMotion(reducedMotion: boolean | null) {
	return {
		initial: { opacity: 0, height: 0 },
		animate: { opacity: 1, height: "auto" },
		exit: {
			opacity: 0,
			height: 0,
			transition: reducedMotion ? INSTANT : TRANSITIONS.base,
		},
		transition: reducedMotion
			? { height: INSTANT, opacity: TRANSITIONS.base }
			: { height: TRANSITIONS.glide, opacity: TRANSITIONS.slow },
	};
}

/**
 * `TRANSITIONS.glide` with the damping raised to critical. A width must not
 * overshoot: a spring closing to 0 dips negative, CSS drops the invalid value,
 * and the column sits a few pixels wide until the spring settles.
 */
const DOCK: Transition = { type: "spring", stiffness: 340, damping: 36, mass: 0.9 };

/** A docked column whose width opens and closes, taking the space from its neighbours. */
export function dockMotion(width: number | "auto", reducedMotion: boolean | null) {
	return {
		initial: { width: 0, opacity: 0 },
		animate: { width, opacity: 1 },
		exit: { width: 0, opacity: 0 },
		transition: reducedMotion
			? { width: INSTANT, opacity: TRANSITIONS.fast }
			: { width: DOCK, opacity: TRANSITIONS.base },
	};
}
