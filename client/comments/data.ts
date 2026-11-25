import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { CommentThread } from "../../src/comments/schema";
import { queryClient, trpc, trpcClient } from "../api";
import { pushToast } from "../ui/Toast";
import { markSelfWrite } from "./self-writes";

const NO_THREADS: CommentThread[] = [];

/** The doc's threads, from the same query the `mdxserve:doc-changed` handler invalidates. */
export function useDocThreads(path: string | null): { threads: CommentThread[]; loaded: boolean } {
	const { data } = useQuery(
		trpc.getDocComments.queryOptions({ path: path ?? "" }, { enabled: path !== null }),
	);
	return useMemo(
		() => ({ threads: data?.threads ?? NO_THREADS, loaded: data !== undefined }),
		[data],
	);
}

function errorText(error: unknown): string {
	return error instanceof Error && error.message ? error.message : "Could not save the comment";
}

export interface CommentActions {
	reply(threadId: string, body: string): Promise<CommentThread[] | null>;
	edit(threadId: string, messageId: string, body: string): Promise<CommentThread[] | null>;
	setResolved(threadId: string, resolved: boolean): Promise<CommentThread[] | null>;
}

/**
 * Runs one comment mutation. The response carries the full thread list, which
 * replaces the cached one at once. A failure becomes a danger toast with the
 * server's message and resolves to null, so callers keep their draft text.
 */
async function runWrite(
	path: string,
	call: () => Promise<{ threads: CommentThread[] }>,
): Promise<CommentThread[] | null> {
	markSelfWrite(path);
	try {
		const result = await call();
		markSelfWrite(path);
		queryClient.setQueryData(trpc.getDocComments.queryKey({ path }), (cached) => ({
			diagnostics: cached?.diagnostics ?? [],
			threads: result.threads,
		}));
		return result.threads;
	} catch (error) {
		pushToast({ tone: "danger", text: errorText(error), dedupeKey: "comment-error" });
		return null;
	}
}

// Each response is a snapshot of the whole thread list. Two writes in flight
// for one doc could land out of order and roll the cache back, so a doc's
// writes run one after another.
const writeQueues = new Map<string, Promise<unknown>>();

function write(
	path: string,
	call: () => Promise<{ threads: CommentThread[] }>,
): Promise<CommentThread[] | null> {
	const previous = writeQueues.get(path) ?? Promise.resolve();
	// runWrite never rejects, so the chain cannot break.
	const run = previous.then(() => runWrite(path, call));
	writeQueues.set(path, run);
	void run.then(() => {
		if (writeQueues.get(path) === run) writeQueues.delete(path);
	});
	return run;
}

export function commentActions(path: string): CommentActions {
	return {
		reply: (threadId, body) =>
			write(path, () => trpcClient.addCommentReply.mutate({ path, threadId, body })),
		edit: (threadId, messageId, body) =>
			write(path, () => trpcClient.editComment.mutate({ path, threadId, messageId, body })),
		setResolved: (threadId, resolved) =>
			write(path, () => trpcClient.setCommentThreadResolved.mutate({ path, threadId, resolved })),
	};
}
