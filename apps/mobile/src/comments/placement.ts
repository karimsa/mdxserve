import { WIDE_WINDOW } from "../vertical-bar";

/** The comments panel's width beside the document. */
export const PANEL_WIDTH = 360;

/**
 * Where the comments go: a sheet over the document in a narrow window (a folded iPhone Duo,
 * any phone in portrait), a column beside it from the width the navigation moves to the top bar. Decided
 * from the window's width, never from the device.
 */
export function panelPlacement(windowWidth: number): "sheet" | "beside" {
	return windowWidth >= WIDE_WINDOW ? "beside" : "sheet";
}
