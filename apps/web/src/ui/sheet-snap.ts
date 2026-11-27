/** Resting heights of the phone bottom sheets, as fractions of the viewport height. */
const SHEET_SNAPS = [0.3, 0.6, 0.92] as const;

/** The snap the sheet opens at. */
export const SHEET_DEFAULT_SNAP = 1;

/** How far ahead a flick is projected: a fast release lands where the finger was heading. */
const FLICK_PROJECTION_SECONDS = 0.2;

/** Released below this share of the lowest snap, the sheet closes instead of settling. */
const CLOSE_BELOW = 0.5;

export function sheetSnapHeights(viewportHeight: number): number[] {
	return SHEET_SNAPS.map((fraction) => Math.round(viewportHeight * fraction));
}

/**
 * Where a released sheet comes to rest: the snap nearest to where the drag was
 * heading, or "close" when it was dragged or flicked well below the lowest one.
 * `velocity` is in px/s, positive while the sheet is growing.
 */
export function settleSheet(
	height: number,
	velocity: number,
	viewportHeight: number,
): number | "close" {
	const snaps = sheetSnapHeights(viewportHeight);
	const projected = height + velocity * FLICK_PROJECTION_SECONDS;
	if (projected < snaps[0] * CLOSE_BELOW) return "close";
	return snaps.reduce((nearest, snap) =>
		Math.abs(snap - projected) < Math.abs(nearest - projected) ? snap : nearest,
	);
}
