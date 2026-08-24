import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { isCancelledError, useQuery } from "@tanstack/react-query";
import { isTRPCClientError } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import { queryClient, trpc } from "./api";
// Type-only: see the comment in client/api.ts — src/ is not served by Vite.
import type { AppRouter } from "../src/api/router";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type DocTreeOutput = RouterOutputs["getDocTree"];
type FolderListingOutput = RouterOutputs["getFolderListing"];

export type ListingEntry = FolderListingOutput["entries"][number];

// Kept in sync with the same type in src/shell.ts — client code can't import
// from src/, so this is a deliberate copy. `dir` has no trailing slash.
export interface RootInfo {
	name: string;
	dir: string;
}

export type Route =
	| { kind: "home"; roots: RootInfo[] }
	| { kind: "listing"; path: string; rootName: string; rootDir: string; entries: ListingEntry[] }
	| { kind: "doc"; path: string; rootName: string; rootDir: string; mtime?: number }
	| { kind: "notfound"; path: string; rootName?: string; rootDir?: string };

// Derived from the router's own output schema (src/api/schemas.ts's
// treeNodeSchema is itself typed against src/listing.ts's TreeNode), so this
// can't drift from the server the way a hand-copied interface could.
export type TreeNode = DocTreeOutput["roots"][number]["nodes"][number];

/** A mounted root together with its doc tree. */
export interface RootTree extends RootInfo {
	tree: TreeNode[];
}

export type DocModuleState =
	{ status: "ok"; Component: ComponentType } | { status: "error"; message: string };

/**
 * Modules imported for doc routes, keyed by absolute path. Shared across
 * the whole SPA session (module scope, not component state) so DocView can
 * render synchronously once a route resolves, and so re-visiting a doc
 * doesn't re-trigger the dynamic import.
 */
export const docModuleCache = new Map<string, DocModuleState>();
const docModulePromises = new Map<string, Promise<void>>();

function ensureDocModule(path: string): Promise<void> {
	if (docModuleCache.has(path)) return Promise.resolve();
	const pending = docModulePromises.get(path);
	if (pending) return pending;

	// Vite serves absolute filesystem paths through its /@fs/ scheme.
	const promise = import(/* @vite-ignore */ "/@fs" + path)
		.then((mod: { default?: ComponentType }) => {
			if (!mod.default) {
				docModuleCache.set(path, { status: "error", message: `${path} has no default export.` });
			} else {
				docModuleCache.set(path, { status: "ok", Component: mod.default });
			}
		})
		.catch((error: unknown) => {
			const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
			docModuleCache.set(path, { status: "error", message });
		})
		.finally(() => {
			docModulePromises.delete(path);
		});

	docModulePromises.set(path, promise);
	return promise;
}

/**
 * What the server-rendered shell already knows about the roots, seeded by
 * entry.tsx before React mounts so multi-root navigation (home crumb, `..`
 * row) doesn't flash in or out while the tree query is still loading.
 */
export const shellInfo: { rootCount: number | null } = { rootCount: null };

function mapRoots(data: DocTreeOutput): RootTree[] {
	return data.roots.map((root) => ({ name: root.name, dir: root.dir, tree: root.nodes }));
}

/** Fetch the doc tree once and cache it; subsequent calls reuse the react-query cache. */
export async function loadTree(): Promise<{ roots: RootTree[] | null }> {
	try {
		const data = await queryClient.ensureQueryData(
			trpc.getDocTree.queryOptions({}, { staleTime: Infinity }),
		);
		return { roots: mapRoots(data) };
	} catch {
		// Leave the previous (possibly absent) tree in place; callers can retry.
		const cached = queryClient.getQueryData(trpc.getDocTree.queryKey({}));
		return { roots: cached ? mapRoots(cached) : null };
	}
}

/** React hook for the shared doc tree; triggers the initial fetch on first use. */
export function useTree(): { roots: RootTree[] | null } {
	const { data } = useQuery(trpc.getDocTree.queryOptions({}, { staleTime: Infinity }));
	// Referentially stable across renders (consumers use this in deps arrays)
	// as long as the underlying query data hasn't changed.
	return useMemo(() => ({ roots: data ? mapRoots(data) : null }), [data]);
}

/** Look up a doc's mtime in the cached tree (undefined if not loaded/found). */
export function docMtime(path: string): number | undefined {
	function find(nodes: TreeNode[]): number | undefined {
		for (const node of nodes) {
			if (!node.isDir && node.path === path) return node.mtime;
			if (node.children) {
				const found = find(node.children);
				if (found !== undefined) return found;
			}
		}
		return undefined;
	}
	const data = queryClient.getQueryData(trpc.getDocTree.queryKey({}));
	if (!data) return undefined;
	for (const root of data.roots) {
		const found = find(root.nodes);
		if (found !== undefined) return found;
	}
	return undefined;
}

/**
 * The mounted root containing `path` (longest `dir` prefix match), or
 * undefined before the tree loads or when `path` lies outside every root.
 */
export function rootFor(path: string): RootInfo | undefined {
	const data = queryClient.getQueryData(trpc.getDocTree.queryKey({}));
	if (!data) return undefined;
	let best: RootInfo | undefined;
	for (const root of data.roots) {
		if (path === root.dir || path.startsWith(`${root.dir}/`)) {
			if (!best || root.dir.length > best.dir.length) best = { name: root.name, dir: root.dir };
		}
	}
	return best;
}

export interface FolderListing {
	/** null until the first successful fetch. */
	entries: ListingEntry[] | null;
	error: boolean;
	/**
	 * The server answered NOT_FOUND on a refetch: the folder was renamed or
	 * deleted on disk after it was opened, so `entries` (kept for
	 * stale-while-revalidate) no longer describe anything real.
	 */
	notFound: boolean;
}

/**
 * Query options for a folder's listing: disabled for the empty path (the
 * roots home page has no folder of its own), always refetched on mount (an
 * h1 edit only ships as a module HMR update, not a listing-changed event, so
 * a cached listing can be stale the moment it's shown), and never cached
 * across navigations (`staleTime: 0`) so re-opening a folder mid-session
 * always sees the latest disk state.
 */
export function listingQueryOptions(folder: string) {
	const base = trpc.getFolderListing.queryOptions(
		{ path: folder },
		{ enabled: folder !== "", staleTime: 0, refetchOnMount: "always" },
	);
	const baseQueryFn = base.queryFn;
	return {
		...base,
		queryFn: async (context: Parameters<NonNullable<typeof baseQueryFn>>[0]) => {
			if (!baseQueryFn) throw new Error("getFolderListing queryOptions did not provide a queryFn");
			const data = await baseQueryFn(context);
			// The server can resolve/normalize the requested path (e.g. trailing
			// slash quirks); make sure whoever asked under `folder` sees it too.
			if (data.path !== folder) {
				queryClient.setQueryData(trpc.getFolderListing.queryKey({ path: data.path }), data);
			}
			return data;
		},
	};
}

/** Seed the cache for a folder from data already fetched elsewhere (e.g. the initial route). */
export function seedListing(listing: FolderListingOutput): void {
	queryClient.setQueryData(trpc.getFolderListing.queryKey({ path: listing.path }), listing);
}

/**
 * Fetch a folder's listing through the cache. A watcher event that lands
 * while this is in flight makes api.ts invalidate the same query with
 * `cancelRefetch`, which rejects *this* caller's promise with a
 * CancelledError even though the refetch it started will succeed — so try
 * once more rather than reporting a perfectly good folder as not found.
 */
async function fetchListing(folder: string): Promise<FolderListingOutput> {
	try {
		return await queryClient.fetchQuery(listingQueryOptions(folder));
	} catch (error) {
		if (!isCancelledError(error)) throw error;
		return queryClient.fetchQuery(listingQueryOptions(folder));
	}
}

/** React hook for a single folder's listing; triggers the initial fetch on first use. */
export function useFolderListing(folder: string): FolderListing {
	const { data, isError, error } = useQuery(listingQueryOptions(folder));
	// Stale-while-revalidate: keep showing the last good entries on a failed
	// refetch rather than blanking the listing out — unless the server says
	// the folder itself is gone, which the caller must surface.
	const notFound = isError && isTRPCClientError(error) && error.data?.code === "NOT_FOUND";
	return { entries: data?.entries ?? null, error: isError && !data, notFound };
}

function titleFor(route: Route): string {
	if (route.kind === "home") return "mdxserve";
	if (route.kind === "listing") return `${route.rootName}${route.path.slice(route.rootDir.length)}`;
	if (route.kind === "doc") {
		const segments = route.path.split("/").filter(Boolean);
		return segments[segments.length - 1] ?? route.rootName;
	}
	return "Not found";
}

/** The `rootName`/`rootDir` a route carries, if any (every kind but `home`). */
function routeRootFields(route: Route): { rootName?: string; rootDir?: string } {
	if (route.kind === "home") return {};
	return { rootName: route.rootName, rootDir: route.rootDir };
}

/**
 * Drives the client-side SPA: resolves a path to a `Route` (querying the
 * folder listing or dynamic-importing a doc module as needed), intercepts
 * same-origin folder/doc link clicks so navigation never triggers a full
 * page load, and keeps `history`/`document.title` in sync.
 */
export function useRouter(initialRoute: Route) {
	const [route, setRoute] = useState<Route>(initialRoute);
	const routeRef = useRef(route);
	routeRef.current = route;

	const loadRoute = useCallback(async (path: string): Promise<Route | null> => {
		if (path === "/") {
			// Mirrors the server's own "/" handling: a single root redirects
			// straight to its listing; otherwise show the roots home page.
			const { roots } = await loadTree();
			if (roots && roots.length === 1) return loadRoute(`${roots[0].dir}/`);
			return {
				kind: "home",
				roots: (roots ?? []).map((rootInfo) => ({ name: rootInfo.name, dir: rootInfo.dir })),
			};
		}

		if (path.endsWith("/")) {
			try {
				const data = await fetchListing(path);
				return {
					kind: "listing",
					path: data.path,
					rootName: data.rootName,
					rootDir: data.rootDir,
					entries: data.entries,
				};
			} catch {
				return { kind: "notfound", path, ...routeRootFields(routeRef.current) };
			}
		}

		if (path.endsWith(".md") || path.endsWith(".mdx")) {
			await ensureDocModule(path);
			const root = rootFor(path);
			const fallback = routeRootFields(routeRef.current);
			return {
				kind: "doc",
				path,
				rootName: root?.name ?? fallback.rootName ?? "",
				rootDir: root?.dir ?? fallback.rootDir ?? "",
			};
		}

		// Not a listing or a doc: let the browser handle it as a normal navigation.
		window.location.assign(path);
		return null;
	}, []);

	const navigate = useCallback(
		(path: string) => {
			loadRoute(path).then((next) => {
				if (!next) return;
				// Push the path the route actually resolved to: with a single root,
				// "/" resolves to that root's listing (mirroring the server's 302),
				// and the address bar should say so.
				history.pushState({}, "", next.kind === "home" ? "/" : next.path);
				document.title = titleFor(next);
				setRoute(next);
			});
		},
		[loadRoute],
	);

	// The initial route's data comes straight from the server-embedded JSON, but a
	// doc route still needs its module dynamic-imported before DocView has anything
	// to render. Kick that off once on mount and force a re-render when it lands.
	useEffect(() => {
		if (initialRoute.kind !== "doc") return;
		let cancelled = false;
		ensureDocModule(initialRoute.path).then(() => {
			if (cancelled) return;
			setRoute((current) =>
				current.kind === "doc" && current.path === initialRoute.path ? { ...current } : current,
			);
		});
		return () => {
			cancelled = true;
		};
		// Intentionally run once: this only concerns the route the page booted with.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		document.title = titleFor(initialRoute);
		// The server embeds the initial listing's entries straight into the page,
		// but useFolderListing consumers still need them in the shared cache.
		if (initialRoute.kind === "listing") {
			seedListing({
				path: initialRoute.path,
				rootName: initialRoute.rootName,
				rootDir: initialRoute.rootDir,
				entries: initialRoute.entries,
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		function onPopState() {
			loadRoute(location.pathname).then((next) => {
				if (!next) return;
				document.title = titleFor(next);
				setRoute(next);
			});
		}
		// We scroll to the top ourselves once the exit transition completes;
		// stop the browser from restoring the old scroll offset over it.
		if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [loadRoute]);

	useEffect(() => {
		function onClick(event: MouseEvent) {
			if (event.defaultPrevented || event.button !== 0) return;
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

			const target = event.target as Element | null;
			const anchor = target?.closest("a");
			if (!anchor) return;
			if (anchor.target || anchor.hasAttribute("download")) return;

			const href = anchor.getAttribute("href");
			if (!href) return;

			let url: URL;
			try {
				url = new URL(href, window.location.href);
			} catch {
				return;
			}
			if (url.origin !== window.location.origin) return;

			// An in-page anchor (#toc-entry) on the current page: let the browser
			// handle the scroll natively instead of intercepting as a navigation.
			if (url.hash && url.pathname === window.location.pathname) return;

			const pathname = url.pathname;
			if (!(pathname.endsWith("/") || pathname.endsWith(".md") || pathname.endsWith(".mdx")))
				return;

			event.preventDefault();
			navigate(pathname);
		}

		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	}, [navigate]);

	// Files added/removed under the open folder are handled by api.ts: the
	// watcher's `mdxserve:listing-changed` event invalidates that folder's
	// query, and AppShell renders the listing route from the live query, so
	// there is nothing route-level to do here.

	return { route, navigate };
}
