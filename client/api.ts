import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpLink, type TRPCClient } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
// src/ is not in Vite's `fs.allow` (see src/rendering/vite.ts), so a *value* import of
// anything from src/ would 404 at runtime — this import is type-only and is
// erased entirely by the compiler.
import type { AppRouter } from "../src/api/router";
import type { inferRouterOutputs } from "@trpc/server";

/**
 * Singletons guarded on `window`, mirroring `__mdxserveRoot` in entry.tsx:
 * the entry module self-accepts HMR, so a fresh `QueryClient`/`trpcClient`
 * created on every re-execution of this module would drop every cached
 * tree/listing/search result mid-session. Reuse the same instances across
 * HMR re-executions instead.
 */
interface MdxserveApiWindow extends Window {
	__mdxserveQueryClient?: QueryClient;
	__mdxserveTrpcClient?: TRPCClient<AppRouter>;
	__mdxserveHmrBound?: boolean;
}

// This module is also evaluated by the SSR render worker (client/ssr-entry.tsx
// → mdx-components.ts → MdSection.tsx imports `trpcClient` for the section
// editor), where there is no `window`. Nothing here is *called* during SSR —
// MdSection only reaches the client from a click handler — so in that case
// plain per-evaluation instances are fine; only the browser needs the
// HMR-surviving singletons.
const windowWithApi = typeof window === "undefined" ? undefined : (window as MdxserveApiWindow);

function makeQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				refetchOnWindowFocus: false,
				gcTime: Infinity,
			},
			mutations: {
				retry: false,
			},
		},
	});
}

function makeTrpcClient(): TRPCClient<AppRouter> {
	return createTRPCClient<AppRouter>({
		// httpLink, not a batch link: GET for queries, POST for mutations, one
		// request per call — keeps Network tab entries legible and matches the
		// one-route-per-call shape the old fetch() call sites had.
		links: [httpLink({ url: "/__mdxserve/trpc" })],
	});
}

export const queryClient: QueryClient = windowWithApi
	? (windowWithApi.__mdxserveQueryClient ??= makeQueryClient())
	: makeQueryClient();

export const trpcClient: TRPCClient<AppRouter> = windowWithApi
	? (windowWithApi.__mdxserveTrpcClient ??= makeTrpcClient())
	: makeTrpcClient();

export const trpc = createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient });

type RouterOutputs = inferRouterOutputs<AppRouter>;

// Files change on disk during a dev session; invalidate the relevant caches
// whenever Vite applies an HMR update (edits to existing files) or the
// watcher reports a listing change (deletions/creations, which don't
// trigger a module HMR update), so the sidebar/search/listings stay in sync
// with the watcher.
//
// Bound once behind a window flag rather than the usual `if (import.meta.hot)`
// module-scope guard: this module can itself be re-executed by HMR (anything
// that imports it is reachable from entry.tsx, which self-accepts), and
// without the flag every edit to this file would stack a duplicate pair of
// listeners.
if (import.meta.hot && windowWithApi && !windowWithApi.__mdxserveHmrBound) {
	windowWithApi.__mdxserveHmrBound = true;

	import.meta.hot.on("vite:afterUpdate", () => {
		void queryClient.invalidateQueries({ ...trpc.getDocTree.queryFilter(), refetchType: "all" });
		// Editing a doc's first h1 changes the title the sidebar shows for it,
		// and that only ships as a module HMR update, not a listing-changed
		// event — so refetch every listing currently mounted on screen (not
		// every one ever cached) to pick the new title up.
		void queryClient.invalidateQueries({ ...trpc.getFolderListing.queryFilter(), type: "active" });
	});

	import.meta.hot.on("mdxserve:listing-changed", (data: { dirs?: string[] }) => {
		void queryClient.invalidateQueries({ ...trpc.getDocTree.queryFilter(), refetchType: "all" });
		for (const changedDir of data?.dirs ?? []) {
			void queryClient.invalidateQueries({
				...trpc.getFolderListing.queryFilter({ path: changedDir }),
				refetchType: "all",
			});
		}
	});

	// The set of served roots itself changed (roots were added/removed at
	// runtime, e.g. via the MCP add_root/remove_root tools or the CLI). The
	// tree is now stale everywhere it's rendered (home page, sidebar), and any
	// folder listing currently on screen may live under a root that no longer
	// exists. This module can't import client/router.ts's `navigate` (that
	// would be a cycle: router.ts already imports from here), so re-dispatch
	// as a plain window event and let useRouter — which owns navigation and
	// knows the current route — decide whether to redirect away from a
	// removed root.
	import.meta.hot.on(
		"mdxserve:roots-changed",
		(data: { added: string[]; removed: string[]; roots: Array<{ name: string; dir: string }> }) => {
			// Patch the cached tree synchronously before the refetch: drop the
			// removed roots and take the event's (possibly re-disambiguated)
			// names, so every consumer — the home page, the sidebar, the
			// redirect below — is consistent right now rather than after the
			// round trip. Added roots arrive with the refetch; there is no tree
			// for them yet.
			const removed = new Set(data.removed);
			const nameByDir = new Map(data.roots.map((info) => [info.dir, info.name]));
			queryClient.setQueriesData<RouterOutputs["getDocTree"]>(
				trpc.getDocTree.queryFilter(),
				(cached) =>
					cached && {
						...cached,
						roots: cached.roots
							.filter((root) => !removed.has(root.dir))
							.map((root) => ({ ...root, name: nameByDir.get(root.dir) ?? root.name })),
					},
			);
			void queryClient.invalidateQueries({ ...trpc.getDocTree.queryFilter(), refetchType: "all" });
			void queryClient.invalidateQueries({
				...trpc.getFolderListing.queryFilter(),
				type: "active",
			});
			window.dispatchEvent(new CustomEvent("mdxserve:roots-changed", { detail: data }));
		},
	);
}
