import type { Transition, Variants } from "framer-motion";

/** Shared ease for every subtle motion in the app: a gentle deceleration. */
export const subtleEase = [0.22, 1, 0.36, 1] as const;

export const enterTransition: Transition = { duration: 0.2, ease: subtleEase };
export const exitTransition: Transition = { duration: 0.15, ease: subtleEase };
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

/** Opacity-only cross-fade for swapping small bits of content in place (labels, toggled views). */
export const fadeSwap: Variants = {
  initial: { opacity: 0 },
  enter: { opacity: 1, transition: fadeSwapTransition },
  exit: { opacity: 0, transition: fadeSwapTransition },
};

/** Stagger container for groups of items that should enter together (listing rows). */
export const stagger: Variants = {
  initial: {},
  enter: { transition: { staggerChildren: 0.02 } },
};
