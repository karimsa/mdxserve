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
 * resized. Where there is no `window`, it reports `serverDefault`.
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

/**
 * How much of the bottom of the layout viewport is hidden, in px, given the
 * visual viewport's offset and height. Zero unless something (an on-screen
 * keyboard) has shrunk the visual viewport.
 * @internal Exported for its tests.
 */
export function coveredBottom(layoutHeight: number, offsetTop: number, height: number): number {
	return Math.max(0, Math.round(layoutHeight - offsetTop - height));
}

/** Whether `element` takes typed text, and so brings up the on-screen keyboard. */
function isEditable(element: Element | null): boolean {
	if (!(element instanceof HTMLElement)) return false;
	if (element.isContentEditable || element instanceof HTMLTextAreaElement) return true;
	return element instanceof HTMLInputElement && !element.readOnly;
}

/**
 * The on-screen keyboard's footprint. iOS does not resize the page when the
 * keyboard opens: it shrinks only the visual viewport, so anything fixed to
 * the bottom of the screen ends up underneath the keyboard. Returns how far
 * such an element has to move up (`inset`) and how tall the visible area is
 * (`visibleHeight`), both tracking the keyboard as it opens and closes.
 */
export function useKeyboardInset(): { inset: number; visibleHeight: number | null } {
	const read = useCallback(() => {
		const viewport = typeof window === "undefined" ? null : window.visualViewport;
		if (!viewport) return { inset: 0, visibleHeight: null };
		return {
			// iOS can keep reporting the shrunken viewport after the keyboard has
			// gone, so the keyboard only counts while something is being typed into.
			inset: isEditable(document.activeElement)
				? coveredBottom(document.documentElement.clientHeight, viewport.offsetTop, viewport.height)
				: 0,
			visibleHeight: Math.round(viewport.height),
		};
	}, []);
	const [state, setState] = useState(read);

	useEffect(() => {
		const viewport = window.visualViewport;
		if (!viewport) return;
		const update = () =>
			setState((previous) => {
				const next = read();
				return next.inset === previous.inset && next.visibleHeight === previous.visibleHeight
					? previous
					: next;
			});
		update();
		// Focus has not landed on its next element yet when focusout fires.
		const afterFocusChange = () => window.setTimeout(update, 0);
		viewport.addEventListener("resize", update);
		viewport.addEventListener("scroll", update);
		document.addEventListener("focusin", update);
		document.addEventListener("focusout", afterFocusChange);
		return () => {
			viewport.removeEventListener("resize", update);
			viewport.removeEventListener("scroll", update);
			document.removeEventListener("focusin", update);
			document.removeEventListener("focusout", afterFocusChange);
		};
	}, [read]);

	return state;
}
