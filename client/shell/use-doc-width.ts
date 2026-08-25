import { useLayoutEffect, useRef, useState } from "react";
import { useSpring } from "framer-motion";
import { TRANSITIONS } from "../motion";
import { DOC_MAX_WIDTH, DOC_MIN_WIDTH } from "../state";

/**
 * Width of the content area (the flex column holding the route wrapper),
 * tracked with a ResizeObserver so widths follow window/sidebar/toc resizes.
 * A layout effect so the first paint already has a real measurement.
 */
export function useContentWidth(ref: React.RefObject<HTMLElement | null>) {
	const [width, setWidth] = useState(0);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => setWidth(el.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref]);

	return width;
}

/**
 * Spring-animated max-width for doc pages, or null while the user hasn't
 * dragged one — the wrapper keeps its default `max-w-prose` then. The spring
 * jumps (not animates) when a drag first activates it, so the page doesn't
 * lurch from a stale value to the grabbed width.
 */
export function useDocMaxWidth(contentWidth: number, stored: number | null) {
	// glide, not snap: the width trails the drag slightly so the spring is felt.
	const spring = useSpring(0, TRANSITIONS.glide);
	const active = useRef(false);
	// Whether the applied target used a real content-area measurement. The first
	// effect run can see contentWidth === 0 (measurement lands one render later);
	// keep jumping until a measured target is applied so a stored width doesn't
	// animate down to its clamp on load.
	const measured = useRef(false);

	useLayoutEffect(() => {
		if (stored === null) {
			active.current = false;
			measured.current = false;
			return;
		}
		const target = Math.min(
			DOC_MAX_WIDTH,
			contentWidth > 0 ? contentWidth : DOC_MAX_WIDTH,
			Math.max(DOC_MIN_WIDTH, stored),
		);
		if (active.current && measured.current) spring.set(target);
		else spring.jump(target);
		active.current = true;
		measured.current = contentWidth > 0;
	}, [contentWidth, stored, spring]);

	return stored === null ? null : spring;
}
