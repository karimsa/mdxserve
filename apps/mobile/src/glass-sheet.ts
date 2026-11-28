import { isLiquidGlassAvailable } from "expo-glass-effect";

/**
 * The heights the app's sheets rest at, as shares of the window's: short (a line or two), about
 * half, and full. The comments and the Contents sheets share them, so the two stay alike.
 */
const SHEET_DETENTS = [0.3, 0.5, 1];
export const SHORT_DETENT = 0;
export const HALF_DETENT = 1;
export const FULL_DETENT = 2;

/**
 * The native stack options of a sheet over the tabs (app/_layout.tsx): a form sheet with the
 * system grabber and the shared heights, the document behind it undimmed and usable up to half
 * height. With Liquid Glass (iOS 26 and later) the screen paints nothing under its content, so
 * the system's see-through sheet material shows; the sheet's own views then paint nothing
 * either (`useSheetGlass`). Without it the theme's background stays.
 */
export function glassSheetOptions(initialDetent: number) {
	return {
		presentation: "formSheet" as const,
		sheetAllowedDetents: SHEET_DETENTS,
		sheetInitialDetentIndex: initialDetent,
		sheetLargestUndimmedDetentIndex: HALF_DETENT,
		sheetGrabberVisible: true,
		...(isLiquidGlassAvailable() ? { contentStyle: { backgroundColor: "transparent" } } : {}),
	};
}

/** Whether a sheet's views leave its surface to the system's glass (iOS 26 and later). */
export function useSheetGlass(): boolean {
	return isLiquidGlassAvailable();
}
