import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { CommentThread } from "../../src/comments/schema";
import { trpc } from "../api";

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
