import { DiagramPreferences } from "../diagrams/Preferences";
import { AnimatePresence, motion, useSpring } from "framer-motion";
import { useAtomValue } from "jotai";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../api";
import { DocView } from "../DocView";
import { HomeView } from "../HomeView";
import { useDebounced } from "../hooks";
import { ListingView } from "../ListingView";
import { fadeRise, TRANSITIONS } from "../motion";
import { useTheme } from "../theme";
import {
	docModuleCache,
	docMtime,
	shellInfo,
	useFolderListing,
	useTree,
	type Route,
	type TreeNode,
} from "../router";
import type { ExportFormat } from "../../src/export/service";
import { exportDocFromViewer } from "../export-doc";
import { Breadcrumb, type BreadcrumbItem } from "../ui/Breadcrumb";
import { PageNav, type PageNavLink } from "../ui/PageNav";
import { SearchDialog, type SearchResult } from "../ui/SearchDialog";
import { Footer } from "./Footer";
import { NotFoundView } from "./NotFoundView";
import { Sidebar } from "./Sidebar";
import { TocRail } from "./TocRail";
import { TopBar } from "./TopBar";
import { useContentWidth, useDocMaxWidth } from "./use-doc-width";
import { DESKTOP_MEDIA } from "../platform";
import {
	contentLayoutAtom,
	docWidthAtom,
	LISTING_MAX_WIDTH,
	LISTING_MIN_WIDTH,
	listingWidthAtom,
} from "../state";

const SIDEBAR_STORAGE_KEY = "mdxserve-sidebar";
const SEARCH_DEBOUNCE_MS = 120;

function readStoredSidebarOpen(): boolean {
	try {
		const value = localStorage.getItem(SIDEBAR_STORAGE_KEY);
		return value === null ? true : value === "1";
	} catch {
		return true;
	}
}

function stripDocExt(name: string): string {
	return name.replace(/\.mdx?$/i, "");
}

/** Depth-first doc order of the tree, matching the sidebar's rendering order. */
function flattenDocs(nodes: TreeNode[] | null): TreeNode[] {
	const result: TreeNode[] = [];
	function walk(list: TreeNode[]) {
		for (const node of list) {
			if (node.isDoc) result.push(node);
			if (node.children) walk(node.children);
		}
	}
	if (nodes) walk(nodes);
	return result;
}

/**
 * Root name -> path segments; every segment is a folder link except a doc's
 * last segment. Folder listings lead with the served directory's absolute
 * path instead, with only the served root onwards being navigable. On the
 * home page there's just the "mdxserve" crumb; everywhere else it's the
 * leading crumb too, but only when the server serves more than one root.
 */
function breadcrumbItems(route: Route, rootsCount: number): BreadcrumbItem[] {
	if (route.kind === "home") return [{ label: "mdxserve" }];

	const items: BreadcrumbItem[] = [];
	if (rootsCount > 1) items.push({ label: "mdxserve", href: "/" });

	const rootDir = route.rootDir ?? "";
	const rootName = route.rootName ?? "";

	if (route.kind === "listing" && rootDir) {
		// The server hands back its raw root, so split on either separator.
		const parents = rootDir.split(/[\\/]/).filter(Boolean).slice(0, -1);
		if (parents.length === 0) items.push({ label: "/" });
		for (const parent of parents) items.push({ label: parent });
	}

	if (rootDir) items.push({ label: rootName, href: `${rootDir}/` });

	const segments = route.path.slice(rootDir.length).split("/").filter(Boolean);
	let acc = rootDir;
	segments.forEach((segment, index) => {
		acc += `/${segment}`;
		const isLast = index === segments.length - 1;
		const isDocLast = isLast && route.kind !== "listing";
		items.push({ label: segment, href: isDocLast ? undefined : `${acc}/` });
	});
	return items;
}

/** Fraction of the content width a folder listing takes by default. */
const LISTING_DEFAULT_FRACTION = 2 / 3;

/**
 * Spring-animated max-width for folder listings: the stored width when the user
 * has dragged one, otherwise 2/3 of the content area's width.
 */
function useListingMaxWidth(contentWidth: number, stored: number | null) {
	// glide, not snap: the width trails the drag slightly so the spring is felt.
	const spring = useSpring(0, TRANSITIONS.glide);
	const initialised = useRef(false);

	// A layout effect so the first listing paint already has a real max-width
	// (the wrapper binds the spring immediately and AnimatePresence skips the
	// initial animation).
	useLayoutEffect(() => {
		if (contentWidth <= 0) return;
		const fallback = Math.round(contentWidth * LISTING_DEFAULT_FRACTION);
		const target = Math.min(
			LISTING_MAX_WIDTH,
			contentWidth,
			Math.max(LISTING_MIN_WIDTH, stored ?? fallback),
		);
		// First measurement: land on the value without animating up from 0.
		if (initialised.current) spring.set(target);
		else {
			spring.jump(target);
			initialised.current = true;
		}
	}, [contentWidth, stored, spring]);

	return spring;
}

export function AppShell({ route, navigate }: { route: Route; navigate: (path: string) => void }) {
	const [diagramPreferences, setDiagramPreferences] = useState(false);
	const { theme, toggle } = useTheme();
	const { roots } = useTree();

	// The listing route's entries come from the server-embedded route JSON (or
	// the navigation fetch) and are seeded into the query cache, so read them
	// back *live* from there: when files are added/removed under the open
	// folder, api.ts invalidates that query and this re-renders with the fresh
	// entries — no route reload, no second fetch racing the invalidation.
	const liveListing = useFolderListing(route.kind === "listing" ? route.path : "");
	const listingRoute = useMemo((): Route | null => {
		if (route.kind !== "listing") return null;
		// A NOT_FOUND refetch means the folder was renamed or deleted on disk
		// after it was opened: show that rather than its stale entries.
		if (liveListing.notFound) {
			return {
				kind: "notfound",
				path: route.path,
				rootName: route.rootName,
				rootDir: route.rootDir,
			};
		}
		return liveListing.entries ? { ...route, entries: liveListing.entries } : route;
	}, [route, liveListing.entries, liveListing.notFound]);
	// Until the tree API answers, trust the count the server-rendered shell
	// embedded so multi-root navigation doesn't flash in after first paint.
	const rootCount = roots?.length ?? shellInfo.rootCount ?? 1;
	// Neither "home" nor a bare "notfound" (before any doc/listing loaded)
	// carries a path/root of its own; fall back to values every consumer below
	// can key off safely.
	const activePath = route.kind === "home" ? "" : route.path;
	const activeRootDir = route.kind === "home" ? "" : (route.rootDir ?? "");

	const [desktopOpen, setDesktopOpen] = useState(readStoredSidebarOpen);
	const [mobileOpen, setMobileOpen] = useState(false);

	const [searchOpen, setSearchOpen] = useState(false);
	const [exporting, setExporting] = useState(false);
	const listingWidth = useAtomValue(listingWidthAtom);
	const docWidth = useAtomValue(docWidthAtom);
	const fullWidth = useAtomValue(contentLayoutAtom) === "full-width";
	const contentRef = useRef<HTMLDivElement>(null);
	const contentWidth = useContentWidth(contentRef);
	const listingMaxWidth = useListingMaxWidth(contentWidth, listingWidth);
	const docMaxWidth = useDocMaxWidth(contentWidth, docWidth);
	const [query, setQuery] = useState("");
	const debouncedQuery = useDebounced(query, SEARCH_DEBOUNCE_MS);
	const { data: searchData, isError: searchIsError } = useQuery(
		trpc.searchDocs.queryOptions(
			{ query: debouncedQuery },
			{ enabled: searchOpen, placeholderData: keepPreviousData, staleTime: 0 },
		),
	);
	const results = searchIsError ? [] : (searchData?.results ?? []);

	// Doc content can render asynchronously after this component's own commit
	// (see DocView's onRendered / client/router.ts's initial-route bootstrap
	// effect); TocRail keys its heading scan on this so it re-scans once the
	// article is actually on the page, not just when `route.path` changes.
	const [tocVersion, setTocVersion] = useState(0);
	const bumpTocVersion = useCallback(() => {
		setTocVersion((previous) => previous + 1);
		// The doc module arrives after the browser's own hash jump, so honour a
		// `#heading` in the URL once the headings exist.
		const hash = window.location.hash.slice(1);
		if (hash) {
			const target = document.getElementById(decodeURIComponent(hash));
			target?.scrollIntoView({ block: "start", behavior: "instant" });
		}
	}, []);

	useEffect(() => {
		try {
			localStorage.setItem(SIDEBAR_STORAGE_KEY, desktopOpen ? "1" : "0");
		} catch {
			// private mode / storage disabled: the choice just won't persist
		}
	}, [desktopOpen]);

	// The docked sidebar is hidden on folder views and the roots home page.
	const sidebarHidden = route.kind === "listing" || route.kind === "home";

	// Drawer rows are plain links handled by the router's global click
	// delegation, not a per-row handler, so close the drawer on any navigation.
	useEffect(() => {
		setMobileOpen(false);
	}, [activePath]);

	// One export at a time: the trigger is disabled while a build runs, and the
	// server queues builds anyway (see startServer).
	const handleExport = useCallback(
		async (format: ExportFormat) => {
			if (route.kind !== "doc" || exporting) return;
			setExporting(true);
			try {
				await exportDocFromViewer({ path: route.path, format });
			} finally {
				setExporting(false);
			}
		},
		[route, exporting],
	);

	const handleToggleSidebar = useCallback(() => {
		if (window.matchMedia(DESKTOP_MEDIA).matches) {
			// A click here would otherwise silently flip (and persist) the
			// preference for the next doc.
			if (sidebarHidden) return;
			setDesktopOpen((previous) => !previous);
		} else {
			setMobileOpen((previous) => !previous);
		}
	}, [sidebarHidden]);

	// Global ⌘K / Ctrl+K to open search, from anywhere on the page.
	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setSearchOpen(true);
			}
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const handleSelectResult = useCallback(
		(result: SearchResult) => {
			setSearchOpen(false);
			if (result.path) navigate(result.path);
		},
		[navigate],
	);

	// The sidebar footer counts every doc across all mounted roots.
	const docCount = useMemo(
		() => (roots ?? []).reduce((sum, root) => sum + flattenDocs(root.tree).length, 0),
		[roots],
	);

	// Prev/next is scoped to the root the open doc lives in, not every mounted root.
	const activeTree = useMemo(() => {
		if (route.kind !== "doc") return null;
		return roots?.find((root) => root.dir === route.rootDir)?.tree ?? null;
	}, [roots, route]);
	const flatDocs = useMemo(() => flattenDocs(activeTree), [activeTree]);
	const { prev, next } = useMemo((): { prev?: PageNavLink; next?: PageNavLink } => {
		if (route.kind !== "doc") return {};
		const index = flatDocs.findIndex((doc) => doc.path === route.path);
		if (index === -1) return {};
		const previousDoc = flatDocs[index - 1];
		const nextDoc = flatDocs[index + 1];
		return {
			prev: previousDoc
				? { label: stripDocExt(previousDoc.name), href: previousDoc.path }
				: undefined,
			next: nextDoc ? { label: stripDocExt(nextDoc.name), href: nextDoc.path } : undefined,
		};
	}, [flatDocs, route]);

	function handleExitComplete() {
		if (!location.hash) window.scrollTo({ top: 0, behavior: "instant" });
	}

	// A folder view is the file navigation, so the docked sidebar would repeat
	// it; hide the column there (and on the roots home page) and let the
	// content take the space.
	const showSidebar = desktopOpen && !sidebarHidden;

	return (
		<div className="min-h-screen bg-surface-page">
			<AnimatePresence>
				{diagramPreferences && <DiagramPreferences onClose={() => setDiagramPreferences(false)} />}
			</AnimatePresence>
			<TopBar
				onDiagramPreferences={shellInfo.sameMachine ? () => setDiagramPreferences(true) : undefined}
				homeHref="/"
				hostLabel={location.host}
				sidebar={{ open: showSidebar, onToggle: handleToggleSidebar }}
				search={{ onOpen: () => setSearchOpen(true) }}
				exportDoc={
					route.kind === "doc" && shellInfo.sameMachine
						? { pending: exporting, onExport: handleExport }
						: undefined
				}
				theme={theme}
				onToggleTheme={toggle}
			/>
			<div className="flex items-start">
				<Sidebar
					rootDir={activeRootDir}
					activePath={activePath}
					docCount={docCount}
					singleRoot={rootCount <= 1}
					desktopOpen={showSidebar}
					mobileOpen={mobileOpen}
					onCloseMobile={() => setMobileOpen(false)}
				/>
				<main className="flex flex-1 min-w-0 px-8 pt-10 pb-24">
					{/* The resize handles clamp drags to this area, and the max-width
					    springs track it, so content never runs under the toc rail. */}
					<div ref={contentRef} data-content-area className="flex flex-1 min-w-0 justify-center">
						<AnimatePresence mode="wait" initial={false} onExitComplete={handleExitComplete}>
							<motion.div
								key={activePath || "/"}
								variants={fadeRise}
								initial="initial"
								animate="enter"
								exit="exit"
								className={
									fullWidth || route.kind === "listing" || (route.kind === "doc" && docMaxWidth)
										? "w-full"
										: "w-full max-w-prose"
								}
								style={
									fullWidth
										? { maxWidth: "100%" }
										: route.kind === "listing"
											? { maxWidth: listingMaxWidth }
											: route.kind === "doc" && docMaxWidth
												? { maxWidth: docMaxWidth }
												: undefined
								}
							>
								<Breadcrumb items={breadcrumbItems(route, rootCount)} />
								<div className="mt-4">
									{route.kind === "listing" ? (
										listingRoute?.kind === "notfound" ? (
											<NotFoundView route={listingRoute} />
										) : (
											<ListingView
												route={listingRoute?.kind === "listing" ? listingRoute : route}
												singleRoot={rootCount <= 1}
											/>
										)
									) : route.kind === "doc" ? (
										<DocView
											path={route.path}
											module={docModuleCache.get(route.path)}
											onRendered={bumpTocVersion}
										/>
									) : route.kind === "home" ? (
										<HomeView route={route} />
									) : (
										<NotFoundView route={route} />
									)}
								</div>
								{route.kind === "doc" && (prev || next) ? (
									<div data-print-hide className="mt-16">
										<PageNav prev={prev} next={next} />
									</div>
								) : null}
								{route.kind === "doc" ? (
									<Footer
										label={route.rootName + route.path.slice(route.rootDir.length)}
										mtime={route.mtime ?? docMtime(route.path)}
									/>
								) : null}
							</motion.div>
						</AnimatePresence>
					</div>
					{route.kind === "doc" ? <TocRail path={route.path} version={tocVersion} /> : null}
				</main>
			</div>
			<SearchDialog
				open={searchOpen}
				query={query}
				results={results}
				onQueryChange={setQuery}
				onClose={() => setSearchOpen(false)}
				onSelect={handleSelectResult}
			/>
		</div>
	);
}
