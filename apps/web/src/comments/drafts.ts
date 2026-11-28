/** The reply field's height; the unsent-text helpers are `@mdxserve/client/comments/drafts`. */

export const FIELD_MIN_HEIGHT = 24;
/** @internal Exported for its tests. */
export const FIELD_MAX_HEIGHT = 120;

/** Height of the one-line field for its content: grows to a cap, then scrolls. */
export function fieldHeight(scrollHeight: number): number {
	return Math.min(FIELD_MAX_HEIGHT, Math.max(FIELD_MIN_HEIGHT, Math.ceil(scrollHeight)));
}
