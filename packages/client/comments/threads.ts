// Type-only: src/ is never served to a client.
import type { CommentMessage, CommentThread } from "@karimsa/mdxserve/src/comments/schema";
import { resolutionPosition, type Resolution } from "./anchor";

export type { CommentMessage, CommentThread };

export interface GroupedThreads {
	/** Unresolved threads found in the document, in document order. */
	open: CommentThread[];
	/** Unresolved threads whose section is gone, in list order. */
	detached: CommentThread[];
	/** Resolved threads, in list order. */
	resolved: CommentThread[];
}

/**
 * A comments panel's lists. Open threads sort by where their anchor resolved, and threads at
 * one place keep the file's order; an open thread with no resolution yet sorts last.
 */
export function groupThreads(
	threads: readonly CommentThread[],
	views: ReadonlyMap<string, { resolution: Resolution }>,
): GroupedThreads {
	const placed: Array<{ thread: CommentThread; position: number; order: number }> = [];
	const detached: CommentThread[] = [];
	const resolved: CommentThread[] = [];
	threads.forEach((thread, order) => {
		if (thread.resolved) {
			resolved.push(thread);
			return;
		}
		const resolution = views.get(thread.id)?.resolution;
		if (resolution?.state === "detached") detached.push(thread);
		else
			placed.push({
				thread,
				position: resolution ? resolutionPosition(resolution) : Number.MAX_SAFE_INTEGER,
				order,
			});
	});
	placed.sort((left, right) => left.position - right.position || left.order - right.order);
	return { open: placed.map((entry) => entry.thread), detached, resolved };
}
