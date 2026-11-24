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
	addThread(anchor: CommentAnchorInput, body: string): Promise<CommentThread[] | null>;
	reply(threadId: string, body: string): Promise<CommentThread[] | null>;
	edit(threadId: string, messageId: string, body: string): Promise<CommentThread[] | null>;
	setResolved(threadId: string, resolved: boolean): Promise<CommentThread[] | null>;
}

type CommentAnchorInput = { heading: string | null; block: string; quote: string };

/**
 * Runs one comment mutation. The response carries the full thread list, which
 * replaces the cached one at once. A failure becomes a danger toast with the
 * server's message and resolves to null, so callers keep their draft text.
 */
async function write(
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

export function commentActions(path: string): CommentActions {
	return {
		addThread: (anchor, body) =>
			write(path, () => trpcClient.addCommentThread.mutate({ path, anchor, body })),
		reply: (threadId, body) =>
			write(path, () => trpcClient.addCommentReply.mutate({ path, threadId, body })),
		edit: (threadId, messageId, body) =>
			write(path, () => trpcClient.editComment.mutate({ path, threadId, messageId, body })),
		setResolved: (threadId, resolved) =>
			write(path, () => trpcClient.setCommentThreadResolved.mutate({ path, threadId, resolved })),
	};
}
