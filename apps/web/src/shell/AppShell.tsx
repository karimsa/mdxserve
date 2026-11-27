import { DiagramPreferences } from "../diagrams/Preferences";
import { EditorActionBar } from "../EditorActionBar";
import { AnimatePresence, motion, useSpring } from "framer-motion";
import { useAtomValue } from "jotai";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
} from "react";
import { trpc } from "../api";
import { DocumentView } from "../document/DocumentView";
import { revealNode } from "../document/reveal";
import { HomeView } from "../HomeView";
import { useDebounced, useFullWidth, useMediaQuery } from "../hooks";
import { ListingView } from "../ListingView";
import { fadeRise, TRANSITIONS } from "../motion";
import { useTheme } from "../theme";
import {
	docMtime,
	shellInfo,
	useFolderListing,
	useTree,
	type Route,
	type TreeNode,
} from "../router";
import { Breadcrumb, type BreadcrumbItem } from "../ui/Breadcrumb";
import { CommentsPopover } from "../comments/CommentsPopover";
import { CommentsSheet } from "../comments/CommentsSheet";
import { COMMENTS_SIDEBAR_WIDTH, CommentsSidebar } from "../comments/CommentsSidebar";
import { GutterCounters } from "../comments/GutterCounters";
import { useCommentsModel, useCommentsPanel } from "../comments/model";
import { SLIDE_OVERSHOOT } from "../comments/motion";
import { SelectionButton } from "../comments/SelectionButton";
import { PageNav, type PageNavLink } from "../ui/PageNav";
import { SearchDialog, type SearchResult } from "../ui/SearchDialog";
import { Footer } from "./Footer";
import { NotFoundView } from "./NotFoundView";
import { Sidebar } from "./Sidebar";
import { TocAbove } from "./TocAbove";
import { TocPopup } from "./TocPopup";
import { TocRail } from "./TocRail";
import { useDocToc } from "./useDocToc";
import { TopBar } from "./TopBar";
import { useContentWidth, useDocMaxWidth } from "./use-doc-width";
import { DESKTOP_MEDIA } from "../platform";
import { docWidthAtom, LISTING_MAX_WIDTH, LISTING_MIN_WIDTH, listingWidthAtom } from "../state";

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
	// Tracks rotation and resizes across the dock/drawer breakpoint, so the
	// toggle and its pressed state always describe the layout on screen.
	const isDesktop = useMediaQuery(DESKTOP_MEDIA, true);

	const [searchOpen, setSearchOpen] = useState(false);
	const listingWidth = useAtomValue(listingWidthAtom);
	const docWidth = useAtomValue(docWidthAtom);
	const fullWidth = useFullWidth();
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

	// Bumped by DocumentView after each commit of new document content, so the
	// table of contents re-attaches its scroll tracking and comment anchors
	// re-resolve against the page.
	const [tocVersion, setTocVersion] = useState(0);
	const bumpTocVersion = useCallback(() => setTocVersion((previous) => previous + 1), []);

	const comments = useCommentsModel(route.kind === "doc" ? route.path : null, tocVersion);
	const commentsPanel = useCommentsPanel();
	// The sidebar slides in over the right-hand track, covering the table-of-contents rail.
	const commentsOpen = comments.available && commentsPanel.open;
	const commentsSidebarOpen = comments.available && commentsPanel.sidebarOpen;
	const setCommentsOpen = commentsPanel.setOpen;
	const closeComments = useCallback(() => setCommentsOpen(false), [setCommentsOpen]);
	// The sidebar is still on screen while it slides out, so the track it covers
	// stays reserved until that exit finishes.
	const [commentsTrackHeld, setCommentsTrackHeld] = useState(commentsSidebarOpen);
	if (commentsSidebarOpen && !commentsTrackHeld) setCommentsTrackHeld(true);

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

	// Widening past the breakpoint docks the sidebar; a drawer left open on the
	// narrow layout must not reappear the next time the screen narrows.
	useEffect(() => {
		if (isDesktop) setMobileOpen(false);
	}, [isDesktop]);

	const handleToggleSidebar = useCallback(() => {
		if (isDesktop) {
			// A click here would otherwise silently flip (and persist) the
			// preference for the next doc.
			if (sidebarHidden) return;
			setDesktopOpen((previous) => !previous);
		} else {
			setMobileOpen((previous) => !previous);
		}
	}, [isDesktop, sidebarHidden]);

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
			if (!result.path) return;
			const target = result.targetId ?? null;
			// Already open: select the tabs on the way and scroll, no navigation.
			if (target !== null && route.kind === "doc" && route.path === result.path) {
				history.replaceState(null, "", `#${encodeURIComponent(target)}`);
				revealNode(target);
				return;
			}
			navigate(target === null ? result.path : `${result.path}#${encodeURIComponent(target)}`);
		},
		[navigate, route],
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

	// Only docs have a table of contents; any other route has no article to scan.
	const toc = useDocToc(route.kind === "doc" ? route.path : "", tocVersion);

	return (
		<div className="relative min-h-screen bg-surface-page">
			<AnimatePresence>
				{diagramPreferences && (
					<DiagramPreferences
						canEditDiagrams={shellInfo.sameMachine && shellInfo.permissions !== "restricted"}
						onClose={() => setDiagramPreferences(false)}
					/>
				)}
			</AnimatePresence>
			<TopBar
				onDiagramPreferences={() => setDiagramPreferences(true)}
				homeHref="/"
				hostLabel={location.host}
				sidebar={{
					// Only the docked sidebar shows a pressed toggle; on a phone the
					// drawer covers the bar, and a pressed state just looks stuck.
					open: isDesktop && showSidebar,
					onToggle: handleToggleSidebar,
				}}
				search={{ onOpen: () => setSearchOpen(true) }}
				theme={theme}
				onToggleTheme={toggle}
				toc={toc.button}
				comments={
					route.kind === "doc" && comments.available
						? {
								count: comments.openCount,
								open: commentsOpen,
								onToggle: () => commentsPanel.setOpen(!commentsPanel.open),
							}
						: undefined
				}
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
				<main className="flex flex-1 min-w-0 px-5 pt-6 pb-16 md:px-8 md:pt-10 md:pb-24">
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
										<DocumentView path={route.path} onRendered={bumpTocVersion} />
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
					{/* The right-hand track, shared by the table-of-contents rail and the
					    comments sidebar. It is as wide as the sidebar (less <main>'s own
					    right padding, plus room for the slide's overshoot), so the sidebar slides in over the rail and can never
					    cover the doc. Where the rail already holds the track open (xl and
					    up, in a doc with headings) opening the sidebar moves nothing;
					    elsewhere the track opens in one step as the sidebar starts to
					    slide and closes in one step once it has left. Inert while covered, or focus could land on hidden links. */}
					{route.kind === "doc" ? (
						<div
							data-print-hide
							inert={commentsSidebarOpen}
							style={
								{
									"--comments-track": `${COMMENTS_SIDEBAR_WIDTH - 32 + SLIDE_OVERSHOOT}px`,
								} as CSSProperties
							}
							className={
								"flex shrink-0 justify-end self-stretch " +
								(commentsTrackHeld
									? "min-w-[var(--comments-track)]"
									: "xl:has-[[data-toc-rail]]:min-w-[var(--comments-track)]")
							}
						>
							<TocRail toc={toc} />
						</div>
					) : null}
				</main>
				<AnimatePresence initial={false} onExitComplete={() => setCommentsTrackHeld(false)}>
					{route.kind === "doc" && commentsSidebarOpen ? (
						<CommentsSidebar key="comments-sidebar" model={comments} onClose={closeComments} />
					) : null}
				</AnimatePresence>
			</div>
			{route.kind === "doc" && comments.available && !commentsPanel.isDesktop ? (
				<CommentsSheet model={comments} open={commentsPanel.open} onClose={closeComments} />
			) : null}
			{route.kind === "doc" && commentsPanel.isDesktop ? (
				<>
					{comments.available && !commentsSidebarOpen ? <GutterCounters model={comments} /> : null}
					<CommentsPopover model={comments} sidebarOpen={commentsSidebarOpen} />
				</>
			) : null}
			{route.kind === "doc" && !comments.readOnly ? <SelectionButton model={comments} /> : null}
			<EditorActionBar />
			<TocAbove toc={toc} />
			<TocPopup toc={toc} />
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
