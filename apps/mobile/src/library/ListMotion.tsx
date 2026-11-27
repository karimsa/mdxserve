import type { ReactNode } from "react";
import Animated, {
	FadeIn,
	FadeOut,
	Keyframe,
	LayoutAnimationConfig,
	LinearTransition,
	useReducedMotion,
} from "react-native-reanimated";
import { DURATIONS, SPRINGS } from "@mdxserve/ui/tokens/springs";

const { glide } = SPRINGS;

/** A row that stays moves to its new place on the web client's `glide` spring. */
const MOVE = LinearTransition.springify()
	.stiffness(glide.stiffness)
	.damping(glide.damping)
	.mass(glide.mass);

/** A new row fades in from 98.5% scale, as the web's `pop` entrance does. */
const ENTER = new Keyframe({
	0: { opacity: 0, transform: [{ scale: 0.985 }] },
	100: { opacity: 1, transform: [{ scale: 1 }] },
}).duration(DURATIONS.base);

/** A row that goes fades out to 99% scale, quicker than it came. */
const EXIT = new Keyframe({
	0: { opacity: 1, transform: [{ scale: 1 }] },
	100: { opacity: 0, transform: [{ scale: 0.99 }] },
}).duration(DURATIONS.fast);

/** With Reduce Motion on, rows only fade: nothing moves or scales. */
const ENTER_REDUCED = FadeIn.duration(DURATIONS.base);
const EXIT_REDUCED = FadeOut.duration(DURATIONS.fast);

/**
 * How rows of a list animate: with Reduce Motion on, they only fade.
 * @internal Exported for its tests.
 */
export function rowMotion(reduced: boolean) {
	return reduced
		? { layout: undefined, entering: ENTER_REDUCED, exiting: EXIT_REDUCED }
		: { layout: MOVE, entering: ENTER, exiting: EXIT };
}

/** How rows of a list animate, given the system's Reduce Motion setting. */
function useRowMotion() {
	return rowMotion(useReducedMotion());
}

/**
 * A list whose rows move, enter and leave with the shared spring. Rows on screen when the list
 * first appears (a screen opening, a folder's first answer) do not animate in.
 */
export function AnimatedList({ children }: { children: ReactNode }) {
	return <LayoutAnimationConfig skipEntering={true}>{children}</LayoutAnimationConfig>;
}

/** One row of an `AnimatedList`; give it a key that is stable across re-sorts. */
export function AnimatedRow({ children }: { children: ReactNode }) {
	const motion = useRowMotion();
	return (
		<Animated.View layout={motion.layout} entering={motion.entering} exiting={motion.exiting}>
			{children}
		</Animated.View>
	);
}
