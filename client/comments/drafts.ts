/** Pure helpers for the reply field and the per-thread unsent text. */

export const FIELD_MIN_HEIGHT = 24;
export const FIELD_MAX_HEIGHT = 120;

/** Height of the one-line field for its content: grows to a cap, then scrolls. */
export function fieldHeight(scrollHeight: number): number {
	return Math.min(FIELD_MAX_HEIGHT, Math.max(FIELD_MIN_HEIGHT, Math.ceil(scrollHeight)));
}

/** Unsent reply text by thread id. Empty text is not stored. */
export type ReplyDrafts = Readonly<Record<string, string>>;

export function withReplyDraft(drafts: ReplyDrafts, threadId: string, text: string): ReplyDrafts {
	if (text === "") {
		if (!(threadId in drafts)) return drafts;
		const { [threadId]: _removed, ...rest } = drafts;
		return rest;
	}
	if (drafts[threadId] === text) return drafts;
	return { ...drafts, [threadId]: text };
}

/** Whether the send button is live: text with something other than whitespace, and no write in flight. */
export function canSend(text: string, disabled: boolean, pending: boolean): boolean {
	return !disabled && !pending && text.trim() !== "";
}
