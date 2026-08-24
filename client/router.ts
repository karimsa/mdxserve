import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";

export interface ListingEntry {
	name: string;
	isDir: boolean;
	isDoc: boolean;
	/** Plain-text first h1 of the doc, when it has one. */
	title?: string;
	/** The same h1 as inline HTML, for display. */
	titleHtml?: string;
	size?: number;
	/** Last modified time, epoch milliseconds. */
	mtime?: number;
}

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

// Kept in sync with the same type in src/listing.ts — client code can't
// import from src/, so this is a deliberate copy.
export interface TreeNode {
	name: string;
	/** Absolute URL path; directories end in "/". */
	path: string;
	isDir: boolean;
	isDoc: boolean;
	/** Last modified time, epoch milliseconds. */
	mtime?: number;
	children?: TreeNode[];
}

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

interface TreeApiResponse {
	roots: { name: string; dir: string; nodes: TreeNode[] }[];
}

interface TreeState {
	roots: RootTree[] | null;
}

type TreeListener = (state: TreeState) => void;

/**
 * Module-scope cache of the doc tree, shared across the whole SPA session
 * (like docModuleCache above) so the shell only fetches it once and every
 * consumer (sidebar, search, docMtime lookups) reads the same snapshot.
 */
export const treeStore: TreeState & { listeners: Set<TreeListener> } = {
	roots: null,
	listeners: new Set(),
};

/**
 * What the server-rendered shell already knows about the roots, seeded by
 * entry.tsx before React mounts so multi-root navigation (home crumb, `..`
 * row) doesn't flash in or out while the tree API is still loading.
 */
export const shellInfo: { rootCount: number | null } = { rootCount: null };

let treeLoadPromise: Promise<TreeState> | null = null;

function snapshotTree(): TreeState {
	return { roots: treeStore.roots };
}

function notifyTreeListeners(): void {
	const snapshot = snapshotTree();
	for (const listener of treeStore.listeners) listener(snapshot);
}

async function fetchTree(): Promise<TreeState> {
	try {
		const res = await fetch("/__mdxserve/api/tree");
		if (res.ok) {
			const data = (await res.json()) as TreeApiResponse;
			treeStore.roots = data.roots.map((r) => ({ name: r.name, dir: r.dir, tree: r.nodes }));
		}
	} catch {
		// Leave the previous (possibly null) tree in place; callers can retry.
	}
	notifyTreeListeners();
	return snapshotTree();
}

/** Fetch the doc tree once and cache it; subsequent calls reuse the same promise. */
export function loadTree(): Promise<TreeState> {
	if (!treeLoadPromise) treeLoadPromise = fetchTree();
	return treeLoadPromise;
}

// Files change on disk during a dev session; re-fetch the tree whenever Vite
// applies an HMR update (edits to existing files) or the watcher reports a
// listing change (deletions/creations, which don't trigger a module HMR
// update) so the sidebar/search stay in sync with the watcher.
if (import.meta.hot) {
	import.meta.hot.on("vite:afterUpdate", () => {
		treeLoadPromise = null;
		void loadTree();
	});
	import.meta.hot.on("mdxserve:listing-changed", () => {
		treeLoadPromise = null;
		void loadTree();
	});
}

/** React hook for the shared doc tree; triggers the initial fetch on first use. */
export function useTree(): TreeState {
	const [state, setState] = useState<TreeState>(snapshotTree);

	useEffect(() => {
		treeStore.listeners.add(setState);
		if (treeStore.roots === null) {
			void loadTree();
		} else {
			setState(snapshotTree());
		}
		return () => {
			treeStore.listeners.delete(setState);
		};
	}, []);

	return state;
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
	if (!treeStore.roots) return undefined;
	for (const root of treeStore.roots) {
		const found = find(root.tree);
		if (found !== undefined) return found;
	}
	return undefined;
}

/**
 * The mounted root containing `path` (longest `dir` prefix match), or
 * undefined before the tree loads or when `path` lies outside every root.
 */
export function rootFor(path: string): RootInfo | undefined {
	if (!treeStore.roots) return undefined;
	let best: RootInfo | undefined;
	for (const root of treeStore.roots) {
		if (path === root.dir || path.startsWith(`${root.dir}/`)) {
			if (!best || root.dir.length > best.dir.length) best = root;
		}
	}
	return best;
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

interface ListingApiResponse {
	path: string;
	rootName: string;
	rootDir: string;
	entries: ListingEntry[];
}

/** The `rootName`/`rootDir` a route carries, if any (every kind but `home`). */
function routeRootFields(route: Route): { rootName?: string; rootDir?: string } {
	if (route.kind === "home") return {};
	return { rootName: route.rootName, rootDir: route.rootDir };
}

/**
 * Drives the client-side SPA: resolves a path to a `Route` (fetching the
 * listing JSON API or dynamic-importing a doc module as needed), intercepts
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
			return { kind: "home", roots: (roots ?? []).map((r) => ({ name: r.name, dir: r.dir })) };
		}

		if (path.endsWith("/")) {
			try {
				const res = await fetch(`/__mdxserve/api/listing?path=${encodeURIComponent(path)}`);
				if (!res.ok) {
					return { kind: "notfound", path, ...routeRootFields(routeRef.current) };
				}
				const data = (await res.json()) as ListingApiResponse;
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

	// The server pushes this over the same HMR websocket Vite already uses for
	// module updates whenever files are added/removed under a watched dir (see
	// src/server.ts). Refetch the open listing in place — no history entry, no
	// title change — so it stays live the way an open .md already does via HMR.
	useEffect(() => {
		if (!import.meta.hot) return;
		function onListingChanged(data: { dirs: string[] }) {
			const current = routeRef.current;
			if (current.kind !== "listing" || !data.dirs.includes(current.path)) return;
			const path = current.path;
			loadRoute(path).then((next) => {
				if (!next) return;
				const latest = routeRef.current;
				if (latest.kind !== "listing" || latest.path !== path) return; // user navigated away meanwhile
				setRoute(next);
			});
		}
		import.meta.hot.on("mdxserve:listing-changed", onListingChanged);
		return () => import.meta.hot?.off("mdxserve:listing-changed", onListingChanged);
	}, [loadRoute]);

	return { route, navigate };
}
