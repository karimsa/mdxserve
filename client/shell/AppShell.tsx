import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DocView } from "../DocView";
import { ListingView } from "../ListingView";
import { fadeRise } from "../motion";
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

/** Root name -> path segments; every segment is a folder link except a doc's last segment. */
function breadcrumbItems(route: Route): BreadcrumbItem[] {
	const items: BreadcrumbItem[] = [{ label: route.rootName, href: "/" }];
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

export function AppShell({ route, navigate }: { route: Route; navigate: (path: string) => void }) {
	const { theme, toggle } = useTheme();
	const { tree, rootDir } = useTree();

	const [desktopOpen, setDesktopOpen] = useState(readStoredSidebarOpen);
	const [mobileOpen, setMobileOpen] = useState(false);

	const [searchOpen, setSearchOpen] = useState(false);
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
				<main className="flex flex-1 min-w-0 justify-center px-8 pt-10 pb-24">
					<AnimatePresence mode="wait" initial={false} onExitComplete={handleExitComplete}>
						<motion.div
							key={route.path}
							variants={fadeRise}
							initial="initial"
							animate="enter"
							exit="exit"
							className="w-full max-w-prose"
						>
							<Breadcrumb items={breadcrumbItems(route)} />
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
