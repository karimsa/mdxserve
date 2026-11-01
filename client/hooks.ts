import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { COMPACT_MEDIA } from "./platform";
import { contentLayoutAtom } from "./state";

/** Returns `value`, updated only after it has stayed unchanged for `delayMs`. */
export function useDebounced<Value>(value: Value, delayMs: number): Value {
	const [debouncedValue, setDebouncedValue] = useState(value);

	useEffect(() => {
		const handle = setTimeout(() => setDebouncedValue(value), delayMs);
		return () => clearTimeout(handle);
	}, [value, delayMs]);

	return debouncedValue;
}

/**
 * Whether the viewport matches a CSS media query, kept live as the window is
 * resized. The SSR pass has no viewport, so it reports `serverDefault`; the
 * store swaps in the real answer on hydration without a mismatch.
 */
export function useMediaQuery(query: string, serverDefault = false): boolean {
	const subscribe = useCallback(
		(onChange: () => void) => {
			const list = window.matchMedia(query);
			list.addEventListener("change", onChange);
			return () => list.removeEventListener("change", onChange);
		},
		[query],
	);
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia(query).matches,
		() => serverDefault,
	);
}

/** Whether the viewport is phone-sized, in either orientation. */
export function useCompactScreen(): boolean {
	return useMediaQuery(COMPACT_MEDIA);
}

/**
 * Whether content fills the available width. Phones always do, whatever the
 * saved preference says; the preference itself is left untouched so it
 * applies again on a larger screen.
 */
export function useFullWidth(): boolean {
	const layout = useAtomValue(contentLayoutAtom);
	const compact = useCompactScreen();
	return compact || layout === "full-width";
}
