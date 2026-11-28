import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { CommentThread } from "@mdxserve/client/comments/threads";
import { createWriteQueue } from "@mdxserve/client/comments/write-queue";
import { useServerClient, useServerQueryOptions } from "../servers/server-query";
import type { KnownServer } from "../servers/store";
import { connectionKey } from "../servers/use-connection";

/** The `getDocComments` result, as the server sends it. */
interface DocComments {
	threads: CommentThread[];
	diagnostics: unknown[];
}

/** The query key of a document's threads; `[serverId, "getDocComments"]` covers every document's. */
export function commentsKey(serverId: string, path: string) {
	return [serverId, "getDocComments", { path }] as const;
}

/**
 * A document's comment threads (KA1). A change on disk, a comment written elsewhere included,
 * arrives over the live update socket, which refetches them, so they never go stale on their
 * own. A restricted server answers too.
 */
export function useDocThreads(server: KnownServer, path: string) {
	const serverQuery = useServerQueryOptions();
	const query = useQuery({
		...serverQuery(server, "getDocComments", { path }, (client, input) =>
			client.getDocComments.query(input),
		),
		staleTime: Infinity,
	});
	return { ...query, data: query.data as DocComments | undefined };
}

/** What a comment write came to: the document's threads after it, or why it failed. */
type WriteResult = { kind: "ok"; threads: CommentThread[] } | { kind: "failed"; message: string };

export interface CommentActions {
	reply(threadId: string, body: string): Promise<WriteResult>;
	edit(threadId: string, messageId: string, body: string): Promise<WriteResult>;
	setResolved(threadId: string, resolved: boolean): Promise<WriteResult>;
}

/**
 * Every write answers with the document's whole thread list, so two in flight could land out of
 * order and roll the list back: one document's writes run one after another.
 */
const writes = createWriteQueue();

function codeOf(error: unknown): string | undefined {
	const data = (error as { data?: { code?: unknown } } | null)?.data;
	return typeof data?.code === "string" ? data.code : undefined;
}

/**
 * The comment writes on one document (KA5 to KA8). A write's answer replaces the cached thread
 * list at once; a failure resolves to the server's message, never throws, so the caller keeps
 * the reader's text (KA13). A `FORBIDDEN` means the server is restricted now: its connection is
 * checked again, which refreshes the permissions the write controls follow. A `NOT_FOUND` (the
 * thread or message went elsewhere) reads the threads again.
 */
export function useCommentActions(server: KnownServer, path: string): CommentActions {
	const queryClient = useQueryClient();
	const clientOf = useServerClient();
	return useMemo(() => {
		const key = commentsKey(server.id, path);
		async function write(
			call: (client: Awaited<ReturnType<typeof clientOf>>) => Promise<{ threads: CommentThread[] }>,
		): Promise<WriteResult> {
			return writes.run(`${server.id}:${path}`, async () => {
				try {
					const { threads } = await call(await clientOf(server));
					queryClient.setQueryData(key, (cached: DocComments | undefined) => ({
						diagnostics: cached?.diagnostics ?? [],
						threads,
					}));
					return { kind: "ok", threads };
				} catch (error) {
					const code = codeOf(error);
					if (code === "FORBIDDEN")
						void queryClient.invalidateQueries({ queryKey: connectionKey(server.id) });
					if (code === "NOT_FOUND") void queryClient.invalidateQueries({ queryKey: key });
					return {
						kind: "failed",
						message:
							error instanceof Error && error.message
								? error.message
								: "The comment could not be saved.",
					};
				}
			});
		}
		return {
			reply: (threadId, body) =>
				write((client) => client.addCommentReply.mutate({ path, threadId, body })),
			edit: (threadId, messageId, body) =>
				write((client) => client.editComment.mutate({ path, threadId, messageId, body })),
			setResolved: (threadId, resolved) =>
				write((client) => client.setCommentThreadResolved.mutate({ path, threadId, resolved })),
		};
	}, [server, path, queryClient, clientOf]);
}
