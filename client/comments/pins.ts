/** Pure placement of the gutter counters. */

export interface PinAnchor {
	id: string;
	/** Top of the anchor's first line, in the pins' coordinate space. */
	top: number;
	/** Height of that line. */
	height: number;
}

export interface PlacedPin {
	id: string;
	top: number;
}

/**
 * Centres each pin on its anchor line, then pushes pins down so none overlaps
 * the one above it by less than `gap`. Input order does not matter; output is
 * in top-to-bottom order.
 */
export function layoutPins(anchors: readonly PinAnchor[], size: number, gap: number): PlacedPin[] {
	const sorted = [...anchors].sort((left, right) => left.top - right.top);
	const placed: PlacedPin[] = [];
	let floor = Number.NEGATIVE_INFINITY;
	for (const anchor of sorted) {
		const top = Math.max(anchor.top + (anchor.height - size) / 2, floor);
		placed.push({ id: anchor.id, top });
		floor = top + size + gap;
	}
	return placed;
}

/** Left edge for a pin: just right of the doc column, kept inside the viewport. */
export function pinLeft(columnRight: number, pinWidth: number, viewportWidth: number): number {
	const margin = 8;
	return Math.max(0, Math.min(columnRight + margin, viewportWidth - pinWidth - margin));
}
