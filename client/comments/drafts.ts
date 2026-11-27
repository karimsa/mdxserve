/** Pure helpers for the reply field and the per-thread unsent text. */

export const FIELD_MIN_HEIGHT = 24;
/** @internal Exported for its tests. */
export const FIELD_MAX_HEIGHT = 120;

/** Height of the one-line field for its content: grows to a cap, then scrolls. */
export function fieldHeight(scrollHeight: number): number {
	return Math.min(FIELD_MAX_HEIGHT, Math.max(FIELD_MIN_HEIGHT, Math.ceil(scrollHeight)));
}

/** Unsent reply text by thread id. Empty text is not stored. */
export type ReplyDrafts = Readonly<Record<string, string>>;

/**
 * The unsent text for a thread. Thread ids come from the file, so one can be
 * "constructor" or "toString": only an own property counts as a draft.
 */
export function replyDraftOf(drafts: ReplyDrafts, threadId: string): string {
	return Object.hasOwn(drafts, threadId) ? drafts[threadId] : "";
}

export function withReplyDraft(drafts: ReplyDrafts, threadId: string, text: string): ReplyDrafts {
	const stored = Object.hasOwn(drafts, threadId);
	if (text === "") {
		if (!stored) return drafts;
		const { [threadId]: _removed, ...rest } = drafts;
		return rest;
	}
	if (stored && drafts[threadId] === text) return drafts;
	return { ...drafts, [threadId]: text };
}

/** Whether the send button is live: text with something other than whitespace, and no write in flight. */
export function canSend(text: string, disabled: boolean, pending: boolean): boolean {
	return !disabled && !pending && text.trim() !== "";
}
