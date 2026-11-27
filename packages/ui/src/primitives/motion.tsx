import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, type ViewProps } from "react-native";

/**
 * Motion shared by the components, matching the web client's (apps/web/src/motion.ts). React
 * Native animates with `Animated`; the web animates the DOM element itself (motion.web.tsx),
 * since react-native-web's `Animated` brings its list components into the bundle with it.
 */
export type MotionViewProps = ViewProps & { className?: string };

/** Where a `SlideFromView` starts: shifted by `dx` and scaled across by `scale`. */
export interface SlideStart {
	dx: number;
	scale: number;
}

/** The web client's gentle deceleration (`subtleEase`). */
const subtleEase = Easing.bezier(0.22, 1, 0.36, 1);

function useReducedMotion(): boolean {
	const [reduced, setReduced] = useState(false);
	useEffect(() => {
		let active = true;
		void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
			if (active) setReduced(value);
		});
		const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
		return () => {
			active = false;
			subscription.remove();
		};
	}, []);
	return reduced;
}

/** `fadeRise`: fades in while rising 8 px over 200 ms when it mounts; only fades with reduced motion. */
export function FadeRiseView({ style, ...props }: MotionViewProps) {
	const progress = useRef(new Animated.Value(0)).current;
	const reduced = useReducedMotion();
	useEffect(() => {
		Animated.timing(progress, {
			toValue: 1,
			duration: 200,
			easing: subtleEase,
			useNativeDriver: true,
		}).start();
	}, [progress]);
	const rise = reduced ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
	return (
		<Animated.View
			{...props}
			style={[style, { opacity: progress, transform: [{ translateY: rise }] }]}
		/>
	);
}

/** `fadeSwapTransition`: fades in over 120 ms each time `shown` turns true. */
export function FadeInView({ shown, style, ...props }: MotionViewProps & { shown: boolean }) {
	const opacity = useRef(new Animated.Value(shown ? 1 : 0)).current;
	useEffect(() => {
		if (!shown) {
			opacity.setValue(0);
			return;
		}
		Animated.timing(opacity, {
			toValue: 1,
			duration: 120,
			easing: subtleEase,
			useNativeDriver: true,
		}).start();
	}, [opacity, shown]);
	return <Animated.View {...props} style={[style, { opacity }]} />;
}

/**
 * Springs (`TRANSITIONS.snap`) from `from` to where it is laid out, each time `from` changes:
 * how the tab underline follows the selection. Skipped with reduced motion.
 */
export function SlideFromView({
	from,
	style,
	...props
}: MotionViewProps & { from: SlideStart | null }) {
	const offset = useRef(new Animated.Value(0)).current;
	const scale = useRef(new Animated.Value(1)).current;
	const reduced = useReducedMotion();
	useEffect(() => {
		if (!from || reduced) return;
		offset.setValue(from.dx);
		scale.setValue(from.scale);
		const spring = (value: Animated.Value, toValue: number) =>
			Animated.spring(value, {
				toValue,
				stiffness: 620,
				damping: 34,
				mass: 0.7,
				useNativeDriver: true,
			});
		Animated.parallel([spring(offset, 0), spring(scale, 1)]).start();
	}, [from, offset, reduced, scale]);
	return (
		<Animated.View
			{...props}
			style={[
				style,
				{ transformOrigin: "left", transform: [{ translateX: offset }, { scaleX: scale }] },
			]}
		/>
	);
}
