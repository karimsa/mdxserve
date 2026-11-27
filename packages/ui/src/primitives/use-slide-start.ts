import { useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import type { SlideStart } from "./motion";

interface Box {
	x: number;
	width: number;
}

/**
 * Where a marker of the selection (a tab's underline, a segmented control's pill) starts when the
 * selection moves: over the option selected before, relative to the one selected now, for
 * `SlideFromView`. Null on the first render, or before both options have been laid out. Each
 * option reports its box through `measure(value)` as its `onLayout`.
 */
export function useSlideStart(selected: string) {
	const boxes = useRef(new Map<string, Box>()).current;
	const [marked, setMarked] = useState(selected);
	const [start, setStart] = useState<SlideStart | null>(null);
	if (marked !== selected) {
		// Derived during render, so the first frame with the new selection already starts there.
		const from = boxes.get(marked);
		const to = boxes.get(selected);
		setMarked(selected);
		setStart(
			from && to && to.width > 0 ? { dx: from.x - to.x, scale: from.width / to.width } : null,
		);
	}
	const measure = (value: string) => (event: LayoutChangeEvent) => {
		const { x, width } = event.nativeEvent.layout;
		boxes.set(value, { x, width });
	};
	return { start, measure };
}
