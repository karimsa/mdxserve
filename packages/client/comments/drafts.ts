/** Pure helpers for the per-thread unsent reply text, shared by the web client and the app. */

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
