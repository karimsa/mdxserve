import { useLayoutEffect, useRef } from "react";
import { View } from "react-native";
import type { MotionViewProps, SlideStart } from "./motion";

/**
 * The web's motion: the Web Animations API on the element react-native-web renders, with the
 * timings of the web client's framer-motion presets. Not react-native-web's `Animated`, which
 * brings FlatList, SectionList and ScrollView into the bundle with it.
 */

const subtleEase = "cubic-bezier(0.22, 1, 0.36, 1)";

function prefersReducedMotion(): boolean {
	return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Samples a spring's position from 0 to 1 as a CSS `linear()` easing over `duration` ms. */
function springEasing(stiffness: number, damping: number, mass: number, duration: number): string {
	const steps = 40;
	const points: string[] = [];
	let position = 0;
	let velocity = 0;
	const substeps = 20;
	const delta = duration / 1000 / steps / substeps;
	for (let step = 0; step <= steps; step++) {
		points.push(String(Math.round(position * 10000) / 10000));
		for (let substep = 0; substep < substeps; substep++) {
			const force = -stiffness * (position - 1) - damping * velocity;
			velocity += (force / mass) * delta;
			position += velocity * delta;
		}
	}
	points[points.length - 1] = "1";
	return `linear(${points.join(", ")})`;
}

/** `TRANSITIONS.snap` (stiffness 620, damping 34, mass 0.7) settles within 300 ms. */
const SNAP_DURATION = 300;
const snapEasing = springEasing(620, 34, 0.7, SNAP_DURATION);

/** The element react-native-web rendered, kept from a callback ref. */
function useElement() {
	const element = useRef<unknown>(null);
	const ref = (node: unknown) => {
		element.current = node;
	};
	return { element, ref };
}

function animate(element: unknown, keyframes: Keyframe[], options: KeyframeAnimationOptions): void {
	// jsdom, which the tests run in, has no Web Animations API.
	if (!(element instanceof HTMLElement) || typeof element.animate !== "function") return;
	try {
		element.animate(keyframes, options);
	} catch {
		// A browser without CSS `linear()` easing rejects the spring curve; ease instead.
		element.animate(keyframes, { ...options, easing: subtleEase });
	}
}

export function FadeRiseView(props: MotionViewProps) {
	const { element, ref } = useElement();
	useLayoutEffect(() => {
		const rise = prefersReducedMotion()
			? []
			: [{ transform: "translateY(8px)" }, { transform: "none" }];
		animate(
			element.current,
			[
				{ opacity: 0, ...rise[0] },
				{ opacity: 1, ...rise[1] },
			],
			{ duration: 200, easing: subtleEase },
		);
	}, [element]);
	return <View {...props} ref={ref} />;
}

export function FadeInView({ shown, ...props }: MotionViewProps & { shown: boolean }) {
	const { element, ref } = useElement();
	const wasShown = useRef(shown);
	useLayoutEffect(() => {
		if (shown && !wasShown.current) {
			animate(element.current, [{ opacity: 0 }, { opacity: 1 }], {
				duration: 120,
				easing: subtleEase,
			});
		}
		wasShown.current = shown;
	}, [element, shown]);
	return <View {...props} ref={ref} />;
}

export function SlideFromView({ from, ...props }: MotionViewProps & { from: SlideStart | null }) {
	const { element, ref } = useElement();
	useLayoutEffect(() => {
		if (!from || prefersReducedMotion()) return;
		animate(
			element.current,
			[
				{ transformOrigin: "left", transform: `translateX(${from.dx}px) scaleX(${from.scale})` },
				{ transformOrigin: "left", transform: "none" },
			],
			{ duration: SNAP_DURATION, easing: snapEasing },
		);
	}, [element, from]);
	return <View {...props} ref={ref} />;
}
