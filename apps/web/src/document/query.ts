import { queryClient, trpc } from "../api";

/**
 * The query for one document's tree. Structural sharing stays on (TanStack
 * Query's default): after a refetch every subtree that is deep-equal to the
 * previous one keeps its object, so the memoized node renderers skip it.
 */
export function documentQueryOptions(path: string) {
	return trpc.getDocument.queryOptions({ path }, { staleTime: Infinity });
}

/** Refetch a document that changed on disk, if this tab has it. */
export function invalidateDocument(path: string): Promise<void> {
	return queryClient.invalidateQueries({ ...trpc.getDocument.queryFilter({ path }) });
}

/** True when this tab has fetched (or is fetching) the document at `path`. */
export function hasDocument(path: string): boolean {
	return queryClient.getQueryState(trpc.getDocument.queryKey({ path })) !== undefined;
}
