import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpLink, type TRPCClient } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
// src/ is not in Vite's `fs.allow` (see src/rendering/vite.ts), so a *value* import of
// anything from src/ would 404 at runtime — this import is type-only and is
// erased entirely by the compiler.
import type { AppRouter } from "../src/api/router";
import type { inferRouterOutputs } from "@trpc/server";
import { realtime } from "./realtime";

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
	__mdxserveRealtimeBound?: boolean;
}

// Tests can evaluate this module without a `window`; plain per-evaluation
// instances are fine there, and only the browser needs the HMR-surviving
// singletons.
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
// whenever Vite applies an HMR update (edits to existing files) or the live
// update socket reports a listing change (deletions/creations, which don't
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
}

/** The `detail` of the window `mdxserve:roots-changed` event that useRouter listens for. */
interface RootsChangedDetail {
	added: string[];
	removed: string[];
	roots: Array<{ name: string; dir: string }>;
}

/**
 * The set of served roots itself changed (roots were added/removed at
 * runtime, e.g. via `mdxserve roots add` / `remove`), or the socket
 * reconnected and it may have. The signal names nothing, so refetch the tree
 * and diff its roots against the cached ones. The tree is then fresh
 * everywhere it's rendered (home page, sidebar), and any folder listing
 * currently on screen may live under a root that no longer exists. This
 * module can't import client/router.ts's `navigate` (that would be a cycle:
 * router.ts already imports from here), so dispatch the diff as a plain
 * window event and let useRouter — which owns navigation and knows the
 * current route — decide whether to redirect away from a removed root.
 */
async function refreshRoots(): Promise<boolean> {
	// Diff against the roots last reported, not the cached tree: another
	// refetch of the tree (a listing signal, an HMR update, one made while the
	// socket was down) may already have replaced the cache with the new roots,
	// and the removal would go unseen. Before any report, that is the roots
	// the tree first loaded with (see `recordInitialRoots`).
	const before = lastReportedRoots ?? cachedRootDirs() ?? new Set<string>();
	let tree: RouterOutputs["getDocTree"];
	try {
		// A request of its own, not `fetchQuery`: that would share a tree request
		// already in flight, whose answer may predate this signal.
		tree = await trpcClient.getDocTree.query({});
	} catch {
		// Leave the baseline alone so the retry still reports the change.
		return false;
	}
	queryClient.setQueryData(trpc.getDocTree.queryKey({}), tree);
	void queryClient.invalidateQueries({ ...trpc.getFolderListing.queryFilter(), type: "active" });
	const after = new Set(tree.roots.map((root) => root.dir));
	lastReportedRoots = after;
	const detail: RootsChangedDetail = {
		added: [...after].filter((dir) => !before.has(dir)),
		removed: [...before].filter((dir) => !after.has(dir)),
		roots: tree.roots.map((root) => ({ name: root.name, dir: root.dir })),
	};
	window.dispatchEvent(new CustomEvent("mdxserve:roots-changed", { detail }));
	return true;
}

/** Retries of a failed roots refresh, and the wait before each. */
const ROOTS_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];

let lastReportedRoots: Set<string> | undefined;
let refreshingRoots = false;

function cachedRootDirs(): Set<string> | undefined {
	const tree = queryClient.getQueryData(trpc.getDocTree.queryKey({}));
	return tree && new Set(tree.roots.map((root) => root.dir));
}

/**
 * Take the roots the tree first loads with as the baseline the first
 * `roots-changed` diff is computed against, so a later refetch of the tree
 * cannot hide a removal from it.
 */
function recordInitialRoots(): void {
	lastReportedRoots ??= cachedRootDirs();
	if (lastReportedRoots) return;
	const unsubscribe = queryClient.getQueryCache().subscribe(() => {
		lastReportedRoots ??= cachedRootDirs();
		if (lastReportedRoots) unsubscribe();
	});
}
let rootsSignalPending = false;

/**
 * Run `refreshRoots` one at a time. A signal that arrives during a refresh
 * runs one more refresh after it, so the last answer applied is from a
 * request sent after the last signal. A refresh whose request fails is
 * retried whole, diff and event included, so the router still hears about
 * a removed root; after the last retry the tree is only invalidated, and the
 * next signal or reconnect reports the change against the same baseline.
 */
function requestRootsRefresh(): void {
	rootsSignalPending = true;
	if (refreshingRoots) return;
	refreshingRoots = true;
	void (async () => {
		while (rootsSignalPending) {
			rootsSignalPending = false;
			let refreshed = await refreshRoots();
			for (const delay of ROOTS_RETRY_DELAYS_MS) {
				if (refreshed || rootsSignalPending) break;
				await new Promise((resolve) => setTimeout(resolve, delay));
				refreshed = await refreshRoots();
			}
			if (!refreshed && !rootsSignalPending) {
				void queryClient.invalidateQueries({
					...trpc.getDocTree.queryFilter(),
					refetchType: "all",
				});
			}
		}
		refreshingRoots = false;
	})();
}

// Bound once per tab for the same reason as the HMR listener above, but not
// behind `import.meta.hot`: these signals come from the live update socket.
if (windowWithApi && !windowWithApi.__mdxserveRealtimeBound) {
	windowWithApi.__mdxserveRealtimeBound = true;

	// The signal names no folder, so refetch the tree and every listing on
	// screen. A listing off screen refetches when it mounts (listingQueryOptions).
	realtime.onListingChanged(() => {
		void queryClient.invalidateQueries({ ...trpc.getDocTree.queryFilter(), refetchType: "all" });
		void queryClient.invalidateQueries({ ...trpc.getFolderListing.queryFilter() });
	});

	recordInitialRoots();
	realtime.onRootsChanged(requestRootsRefresh);
}
