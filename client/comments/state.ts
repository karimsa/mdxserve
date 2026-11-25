import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { ReplyDrafts } from "./drafts";

/** Desktop sidebar open state; persisted. Takes the table-of-contents rail's place while open. */
export const commentsOpenAtom = atomWithStorage<boolean>(
	"mdxserve.comments.open",
	false,
	undefined,
	{
		getOnInit: true,
	},
);

/** Phone sheet open state; never persisted, or the sheet would cover the page on every load. */
export const commentsSheetOpenAtom = atom(false);

/** The focused thread, drawn with the active highlight and marked in the panel. */
export const activeThreadAtom = atom<string | null>(null);

/** The thread shown in the popover (desktop, sidebar closed). */
export const popoverThreadAtom = atom<string | null>(null);

/** Unsent reply text per thread; lives as long as the doc stays open. */
export const replyDraftsAtom = atom<ReplyDrafts>({});

/**
 * Replies and new comments being saved, by key (`pendingReplyKey`, `pendingDraftKey`).
 * Shared, not component state: a thread or composer that remounts mid-save must
 * still see its own send as pending, or the same text could be sent twice.
 */
export const pendingSendsAtom = atom<ReadonlySet<string>>(new Set<string>());

export function pendingReplyKey(path: string, threadId: string): string {
	return `reply:${path}:${threadId}`;
}

export function withPendingSend(
	pending: ReadonlySet<string>,
	key: string,
	active: boolean,
): ReadonlySet<string> {
	if (pending.has(key) === active) return pending;
	const next = new Set(pending);
	if (active) next.add(key);
	else next.delete(key);
	return next;
}
