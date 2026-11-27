/**
 * Highlights use the CSS Custom Highlight API, so React's DOM is never touched
 * and a doc re-render cannot clash with the marks. Browsers without it show the
 * panel and no marks. Styles live in client/app.css (`::highlight()`).
 */
const HIGHLIGHT_NAME = "mdxserve-comment";
const ACTIVE_HIGHLIGHT_NAME = "mdxserve-comment-active";

function supportsHighlights(): boolean {
	return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

export interface HighlightEntry {
	threadId: string;
	range: Range;
}

/** Entries currently drawn, for click hit-testing. */
let drawn: HighlightEntry[] = [];

export function setHighlights(entries: readonly HighlightEntry[], activeId: string | null): void {
	drawn = [...entries];
	if (!supportsHighlights()) return;
	if (entries.length === 0) CSS.highlights.delete(HIGHLIGHT_NAME);
	else CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...entries.map((entry) => entry.range)));

	const active = entries.find((entry) => entry.threadId === activeId);
	if (!active) {
		CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
		return;
	}
	const highlight = new Highlight(active.range);
	highlight.priority = 1;
	CSS.highlights.set(ACTIVE_HIGHLIGHT_NAME, highlight);
}

export function clearHighlights(): void {
	drawn = [];
	if (!supportsHighlights()) return;
	CSS.highlights.delete(HIGHLIGHT_NAME);
	CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
}

function caretAt(clientX: number, clientY: number): { node: Node; offset: number } | null {
	if (typeof document.caretPositionFromPoint === "function") {
		const position = document.caretPositionFromPoint(clientX, clientY);
		return position ? { node: position.offsetNode, offset: position.offset } : null;
	}
	// Safari and older Chromium.
	const legacy = (
		document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
	).caretRangeFromPoint?.(clientX, clientY);
	return legacy ? { node: legacy.startContainer, offset: legacy.startOffset } : null;
}

/** The thread whose highlight is under the point; the shortest range wins when they overlap. */
export function threadAtPoint(clientX: number, clientY: number): string | null {
	if (drawn.length === 0) return null;
	const caret = caretAt(clientX, clientY);
	if (!caret) return null;
	let best: { threadId: string; length: number } | null = null;
	for (const entry of drawn) {
		let inside = false;
		try {
			inside = entry.range.isPointInRange(caret.node, caret.offset);
		} catch {
			inside = false;
		}
		if (!inside) continue;
		// The caret snaps to the nearest character, so also require the point to be on the text.
		const onText = Array.from(entry.range.getClientRects()).some(
			(rect) =>
				clientX >= rect.left &&
				clientX <= rect.right &&
				clientY >= rect.top &&
				clientY <= rect.bottom,
		);
		if (!onText) continue;
		const length = entry.range.toString().length;
		if (!best || length < best.length) best = { threadId: entry.threadId, length };
	}
	return best?.threadId ?? null;
}
