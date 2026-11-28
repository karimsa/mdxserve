import { useQuery } from "@tanstack/react-query";
import type { CommentThread } from "@mdxserve/client/comments/threads";
import { useServerQueryOptions } from "../servers/server-query";
import type { KnownServer } from "../servers/store";

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
