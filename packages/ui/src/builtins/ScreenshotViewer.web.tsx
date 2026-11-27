import type { ExpandedScreenshot } from "./Screenshot";

/**
 * Nothing: the web client always passes its own expand modal to `Screenshot`
 * (apps/web/src/builtins/Screenshot.tsx), which draws on its DOM dialog and pan-zoom code.
 */
export function ScreenshotViewer(_view: ExpandedScreenshot) {
	return null;
}
