/**
 * The springs and short durations both clients move things with. The web client's
 * framer-motion transitions (apps/web/src/motion.ts `TRANSITIONS`) and the app's Reanimated
 * layout transitions read these numbers, which are the web's `--spring-*` tokens
 * (apps/web/src/design/tokens/motion.css). Nothing overshoots past 2% and nothing travels
 * further than it must.
 */
export const SPRINGS = {
	/** Controls: press, toggle knobs, segmented pills (`--spring-snap`). */
	snap: { stiffness: 620, damping: 34, mass: 0.7 },
	/** Surfaces and rows: dialogs, toasts, disclosure, a list re-ordering (`--spring-glide`). */
	glide: { stiffness: 340, damping: 30, mass: 0.9 },
} as const;

/** Tween durations in milliseconds, for opacity and colour only (`TRANSITIONS.fast` and `base`). */
export const DURATIONS = { fast: 120, base: 180 } as const;
