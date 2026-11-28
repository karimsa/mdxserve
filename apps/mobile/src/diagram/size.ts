export interface DiagramSize {
	width: number;
	height: number;
}

/** The height of an inline diagram's frame before its size is known. */
export const UNMEASURED_HEIGHT = 200;

/**
 * The box an inline diagram is drawn in: the frame's full width, and the height of the whole
 * drawing scaled down to that width and to `maxHeight`, never scaled up. The SVG keeps its
 * aspect ratio inside the box, centred.
 */
export function inlineDiagramSize(input: {
	natural: DiagramSize;
	/** The frame body's width in points. */
	available: number;
	maxHeight: number;
	/** The least height the box takes, whatever the drawing's. */
	minHeight: number;
}): DiagramSize {
	const { natural, available, maxHeight, minHeight } = input;
	const valid =
		[natural.width, natural.height, available, maxHeight].every(Number.isFinite) &&
		natural.width > 0 &&
		natural.height > 0 &&
		available > 0 &&
		maxHeight > 0;
	if (!valid) return { width: 0, height: UNMEASURED_HEIGHT };
	const scale = Math.min(1, available / natural.width, maxHeight / natural.height);
	// The small allowance keeps rounding in the division from adding a whole point.
	const height = Math.ceil(natural.height * scale - 1e-6);
	return { width: available, height: Math.max(minHeight, height) };
}
