import { AnimatePresence, motion, useSpring } from "framer-motion";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DocView } from "../DocView";
import { ListingView } from "../ListingView";
import { fadeRise, T } from "../motion";
import { useTheme } from "../theme";
import { useTree, type Route, type TreeNode } from "../router";
import { Breadcrumb, type BreadcrumbItem } from "../ui/Breadcrumb";
import { PageNav, type PageNavLink } from "../ui/PageNav";
import { SearchDialog, type SearchResult } from "../ui/SearchDialog";
import { Footer } from "./Footer";
import { NotFoundView } from "./NotFoundView";
import { Sidebar } from "./Sidebar";
import { TocRail } from "./TocRail";
import { TopBar } from "./TopBar";
import {
	DOC_MAX_WIDTH,
	DOC_MIN_WIDTH,
	docWidthAtom,
	LISTING_MAX_WIDTH,
	LISTING_MIN_WIDTH,
	listingWidthAtom,
} from "../state";

const SIDEBAR_STORAGE_KEY = "mdxserve-sidebar";
const DESKTOP_BREAKPOINT = "(min-width: 768px)";
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
 * path instead, with only the served root onwards being navigable.
 */
function breadcrumbItems(route: Route, rootDir: string): BreadcrumbItem[] {
	const items: BreadcrumbItem[] = [];
	if (route.kind === "listing" && rootDir) {
		// The server hands back its raw root, so split on either separator.
		const parents = rootDir.split(/[\\/]/).filter(Boolean).slice(0, -1);
		if (parents.length === 0) items.push({ label: "/" });
		for (const parent of parents) items.push({ label: parent });
	}
	items.push({ label: route.rootName, href: "/" });
	const segments = route.path.split("/").filter(Boolean);
	let acc = "";
	segments.forEach((segment, i) => {
		acc += `/${segment}`;
		const isLast = i === segments.length - 1;
		const isDocLast = isLast && route.kind !== "listing";
		items.push({ label: segment, href: isDocLast ? undefined : `${acc}/` });
	});
	return items;
}

/** Fraction of the content width a folder listing takes by default. */
const LISTING_DEFAULT_FRACTION = 2 / 3;

/**
 * Width of the content area (the flex column holding the route wrapper),
 * tracked with a ResizeObserver so widths follow window/sidebar/toc resizes.
 * A layout effect so the first paint already has a real measurement.
 */
function useContentWidth(ref: React.RefObject<HTMLElement | null>) {
	const [width, setWidth] = useState(0);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => setWidth(el.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref]);

	return width;
}

/**
 * Spring-animated max-width for folder listings: the stored width when the user
 * has dragged one, otherwise 2/3 of the content area's width.
 */
function useListingMaxWidth(contentWidth: number, stored: number | null) {
	// glide, not snap: the width trails the drag slightly so the spring is felt.
	const spring = useSpring(0, T.glide);
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

/**
 * Spring-animated max-width for doc pages, or null while the user hasn't
 * dragged one — the wrapper keeps its default `max-w-prose` then. The spring
 * jumps (not animates) when a drag first activates it, so the page doesn't
 * lurch from a stale value to the grabbed width.
 */
function useDocMaxWidth(contentWidth: number, stored: number | null) {
	// glide, not snap: the width trails the drag slightly so the spring is felt.
	const spring = useSpring(0, T.glide);
	const active = useRef(false);
	// Whether the applied target used a real content-area measurement. The first
	// effect run can see contentWidth === 0 (measurement lands one render later);
	// keep jumping until a measured target is applied so a stored width doesn't
	// animate down to its clamp on load.
	const measured = useRef(false);

	useLayoutEffect(() => {
		if (stored === null) {
			active.current = false;
			measured.current = false;
			return;
		}
		const target = Math.min(
			DOC_MAX_WIDTH,
			contentWidth > 0 ? contentWidth : DOC_MAX_WIDTH,
			Math.max(DOC_MIN_WIDTH, stored),
		);
		if (active.current && measured.current) spring.set(target);
		else spring.jump(target);
		active.current = true;
		measured.current = contentWidth > 0;
	}, [contentWidth, stored, spring]);

	return stored === null ? null : spring;
}

export function AppShell({ route, navigate }: { route: Route; navigate: (path: string) => void }) {
	const { theme, toggle } = useTheme();
	const { tree, rootDir } = useTree();

	const [desktopOpen, setDesktopOpen] = useState(readStoredSidebarOpen);
	const [mobileOpen, setMobileOpen] = useState(false);

	const [searchOpen, setSearchOpen] = useState(false);
	const listingWidth = useAtomValue(listingWidthAtom);
	const docWidth = useAtomValue(docWidthAtom);
	const contentRef = useRef<HTMLDivElement>(null);
	const contentWidth = useContentWidth(contentRef);
	const listingMaxWidth = useListingMaxWidth(contentWidth, listingWidth);
	const docMaxWidth = useDocMaxWidth(contentWidth, docWidth);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SearchResult[]>([]);

	// Doc content can render asynchronously after this component's own commit
	// (see DocView's onRendered / client/router.ts's initial-route bootstrap
	// effect); TocRail keys its heading scan on this so it re-scans once the
	// article is actually on the page, not just when `route.path` changes.
	const [tocVersion, setTocVersion] = useState(0);
	const bumpTocVersion = useCallback(() => {
		setTocVersion((v) => v + 1);
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

	const isListing = route.kind === "listing";
	const handleToggleSidebar = useCallback(() => {
		if (window.matchMedia(DESKTOP_BREAKPOINT).matches) {
			// The docked sidebar is hidden on folder views, so a click here would
			// silently flip (and persist) the preference for the next doc.
			if (isListing) return;
			setDesktopOpen((v) => !v);
		} else {
			setMobileOpen((v) => !v);
		}
	}, [isListing]);

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

	// Debounced search fetch; empty query still fetches the endpoint's default results.
	useEffect(() => {
		if (!searchOpen) return;
		const handle = setTimeout(() => {
			fetch(`/__mdxserve/api/search?q=${encodeURIComponent(query)}`)
				.then((res) =>
					res.ok ? (res.json() as Promise<{ results: SearchResult[] }>) : { results: [] },
				)
				.then((data) => setResults(data.results ?? []))
				.catch(() => setResults([]));
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(handle);
	}, [query, searchOpen]);

	const handleSelectResult = useCallback(
		(result: SearchResult) => {
			setSearchOpen(false);
			if (result.path) navigate(result.path);
		},
		[navigate],
	);

	// SidebarNav's onNavigate is `(path?: string) => void` (group rows have no
	// path); the router's navigate always wants a string.
	const handleSidebarNavigate = useCallback(
		(path?: string) => {
			if (path) navigate(path);
		},
		[navigate],
	);

	const flatDocs = useMemo(() => flattenDocs(tree), [tree]);
	const { prev, next } = useMemo((): { prev?: PageNavLink; next?: PageNavLink } => {
		if (route.kind !== "doc") return {};
		const index = flatDocs.findIndex((doc) => doc.path === route.path);
		if (index === -1) return {};
		const p = flatDocs[index - 1];
		const n = flatDocs[index + 1];
		return {
			prev: p ? { label: stripDocExt(p.name), href: p.path } : undefined,
			next: n ? { label: stripDocExt(n.name), href: n.path } : undefined,
		};
	}, [flatDocs, route]);

	function handleExitComplete() {
		if (!location.hash) window.scrollTo({ top: 0, behavior: "instant" });
	}

	// A folder view is the file navigation, so the docked sidebar would repeat
	// it; hide the column there and let the listing take the space.
	const showSidebar = desktopOpen && route.kind !== "listing";

	return (
		<div className="min-h-screen bg-surface-page">
			<TopBar
				sidebarOpen={showSidebar}
				onToggleSidebar={handleToggleSidebar}
				onOpenSearch={() => setSearchOpen(true)}
				theme={theme}
				onToggleTheme={toggle}
			/>
			<div className="flex items-start">
				<Sidebar
					tree={tree}
					rootDir={rootDir}
					activePath={route.path}
					navigate={handleSidebarNavigate}
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
								key={route.path}
								variants={fadeRise}
								initial="initial"
								animate="enter"
								exit="exit"
								className={
									route.kind === "listing" || (route.kind === "doc" && docMaxWidth)
										? "w-full"
										: "w-full max-w-prose"
								}
								style={
									route.kind === "listing"
										? { maxWidth: listingMaxWidth }
										: route.kind === "doc" && docMaxWidth
											? { maxWidth: docMaxWidth }
											: undefined
								}
							>
								<Breadcrumb items={breadcrumbItems(route, rootDir)} />
								<div className="mt-4">
									{route.kind === "listing" ? (
										<ListingView route={route} />
									) : route.kind === "doc" ? (
										<DocView route={route} onRendered={bumpTocVersion} />
									) : (
										<NotFoundView route={route} />
									)}
								</div>
								{route.kind === "doc" && (prev || next) ? (
									<div data-print-hide className="mt-16">
										<PageNav prev={prev} next={next} />
									</div>
								) : null}
								{route.kind === "doc" ? <Footer route={route} /> : null}
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
