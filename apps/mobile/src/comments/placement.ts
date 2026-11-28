import { WIDE_WINDOW } from "../vertical-bar";

/** The comments panel's height under the document, as a share of the window's, and its least. */
export const PANEL_SHARE = 0.46;
export const PANEL_MIN_HEIGHT = 280;
/** The comments panel's width beside the document. */
export const PANEL_WIDTH = 360;

/**
 * Where the comments panel goes: under the document in a narrow window (a folded iPhone Duo,
 * any phone in portrait), beside it from the width the navigation moves to the top bar. Decided
 * from the window's width, never from the device.
 */
export function panelPlacement(windowWidth: number): "below" | "beside" {
	return windowWidth >= WIDE_WINDOW ? "beside" : "below";
}
