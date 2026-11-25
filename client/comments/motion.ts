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
 * The comments sidebar's slide: slower and looser than `TRANSITIONS.glide`, so
 * the panel visibly travels and settles with a small overshoot (about 3% of
 * its width). The sidebar bleeds past the window edge by `SLIDE_BLEED` so the
 * overshoot never opens a gap there.
 */
export const SLIDE: Transition = { type: "spring", stiffness: 170, damping: 19, mass: 1 };
export const SLIDE_BLEED = 32;
/**
 * Leaving is a plain accelerate-out: a spring's settling would happen off
 * screen, and the layout waits for the exit to finish before it reclaims the
 * sidebar's track.
 */
export const SLIDE_OUT: Transition = { duration: 0.3, ease: [0.4, 0, 0.6, 1] };
