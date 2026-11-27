import { LayoutGroup } from "framer-motion";
import { useRef } from "react";
import { useAtom } from "jotai";
import { Icon } from "@mdxserve/ui/primitives/Icon";
import { BottomSheet } from "../ui/BottomSheet";
import { IconButton } from "../ui/IconButton";
import { ResizeHandle } from "../ui/ResizeHandle";
import { ListingView } from "../ListingView";
import { useFolderListing } from "../router";
import { shortenHome } from "@mdxserve/client/format";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, sidebarWidthAtom } from "../state";

const DOCKED_CLASS =
	"shrink-0 sticky top-topbar h-[calc(100vh-var(--topbar-height))] border-r border-border-subtle";

function clampWidth(px: number): number {
	return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(px)));
}

/** "/a/b.md" -> "/a/"; "/x.md" -> "/"; a path already ending in "/" is unchanged. */
function folderOf(path: string): string {
	if (path.endsWith("/")) return path;
	const lastSlash = path.lastIndexOf("/");
	return path.slice(0, lastSlash + 1);
}

function SidebarBody({
	rootDir,
	activePath,
	docCount,
	singleRoot,
	layoutGroupId,
}: {
	rootDir: string;
	activePath: string;
	docCount: number;
	singleRoot: boolean;
	layoutGroupId: string;
}) {
	// The roots home page has no path of its own (the mobile drawer can still
	// open there); skip the listing rather than fetch "".
	const folder = activePath ? folderOf(activePath) : "";
	const { entries, error } = useFolderListing(folder);

	return (
		<>
			{/* Plain <a>: the router's global click delegation handles navigation. */}
			<a
				href={rootDir ? `${rootDir}/` : "/"}
				title={rootDir}
				className="mb-1 flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[length:var(--size-2xs)] text-text-subtle no-underline hover:bg-surface-hover hover:text-text-heading"
			>
				<Icon name="folder-open" size={13} className="shrink-0" />
				<span className="truncate">{rootDir ? shortenHome(rootDir) : "mdxserve"}</span>
			</a>
			{!folder ? null : entries ? (
				// The desktop column and mobile drawer can both be mounted, and both
				// contain a row with layoutId="sidebar-active", so each gets its own
				// namespace here.
				<LayoutGroup id={layoutGroupId}>
					<ListingView
						route={{ path: folder, rootDir, entries }}
						mode="sidebar"
						activePath={activePath}
						singleRoot={singleRoot}
					/>
				</LayoutGroup>
			) : error ? (
				<p className="px-2 text-[13px] text-text-subtle">Couldn't load this folder.</p>
			) : null}
			<div className="mt-4 flex items-center gap-2 border-t border-border-subtle px-2 pt-3 text-[13px] leading-normal font-medium text-text-subtle">
				<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" />
				Watching {docCount} {docCount === 1 ? "file" : "files"}
			</div>
		</>
	);
}

export function Sidebar({
	rootDir,
	activePath,
	docCount,
	singleRoot,
	desktopOpen,
	mobileOpen,
	onCloseMobile,
}: {
	rootDir: string;
	activePath: string;
	docCount: number;
	singleRoot: boolean;
	desktopOpen: boolean;
	mobileOpen: boolean;
	onCloseMobile: () => void;
}) {
	const [width, setWidth] = useAtom(sidebarWidthAtom);
	const asideRef = useRef<HTMLDivElement>(null);

	return (
		<>
			{/* Phones: the same bottom sheet as the comments panel, over a scrim. */}
			<BottomSheet
				open={mobileOpen}
				onClose={onCloseMobile}
				label="Files"
				scrim
				// Rows are plain links handled by the router, and tapping the already
				// active doc never changes the route, so close on any link tap here.
				onClick={(event) => {
					if ((event.target as HTMLElement).closest("a[href]")) onCloseMobile();
				}}
			>
				{(dragHandlers) => (
					<>
						<div
							{...dragHandlers}
							className="flex h-[42px] shrink-0 touch-none items-center border-b border-border-subtle pr-2 pl-4"
						>
							<span className="flex-1 font-sans text-[length:var(--size-sm)] font-semibold text-text-heading">
								Files
							</span>
							<IconButton
								icon="x"
								label="Close navigation"
								size="sm"
								className="h-9 w-9"
								onClick={onCloseMobile}
							/>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-3 pb-6">
							<SidebarBody
								rootDir={rootDir}
								activePath={activePath}
								docCount={docCount}
								singleRoot={singleRoot}
								layoutGroupId="sidebar-mobile"
							/>
						</div>
					</>
				)}
			</BottomSheet>

			{/* Desktop docked column. */}
			{desktopOpen ? (
				<aside
					ref={asideRef}
					data-print-hide
					className={"relative hidden md:block " + DOCKED_CLASS}
					style={{ width: clampWidth(width) }}
				>
					<div className="h-full overflow-y-auto px-3 py-6">
						<SidebarBody
							rootDir={rootDir}
							activePath={activePath}
							docCount={docCount}
							singleRoot={singleRoot}
							layoutGroupId="sidebar-desktop"
						/>
					</div>
					{/* Sibling of the scroller, not inside it, so overflow-y-auto can't clip it. */}
					<ResizeHandle
						side="right"
						anchored
						container={asideRef}
						onResize={setWidth}
						label="Resize sidebar"
						minWidth={SIDEBAR_MIN_WIDTH}
						maxWidth={SIDEBAR_MAX_WIDTH}
					/>
				</aside>
			) : null}
		</>
	);
}
