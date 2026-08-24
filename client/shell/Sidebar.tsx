import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { V } from "../motion";
import { Icon } from "../ui/Icon";
import { SidebarNav, type NavItem } from "../ui/SidebarNav";
import type { RootTree, TreeNode } from "../router";
import { shortenHome } from "../format";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, sidebarWidthAtom } from "../state";

const DOCKED_CLASS =
	"shrink-0 sticky top-topbar h-[calc(100vh-var(--topbar-height))] border-r border-border-subtle";

function clampWidth(px: number): number {
	return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(px)));
}

/**
 * Thin vertical strip on the sidebar's right edge; dragging it resizes the
 * docked column. Uses pointer capture so the drag survives the cursor leaving
 * the strip.
 */
function ResizeHandle({ onResize }: { onResize: (width: number) => void }) {
	const dragging = useRef(false);

	// The handle unmounts with the sidebar (navigating to a folder, toggling it
	// closed); make sure an interrupted drag doesn't leave the body styles behind.
	useEffect(() => {
		return () => {
			if (!dragging.current) return;
			dragging.current = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};
	}, []);

	const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		dragging.current = true;
		event.currentTarget.setPointerCapture(event.pointerId);
		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
	}, []);

	const onPointerMove = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (!dragging.current) return;
			// The sidebar is flush with the viewport's left edge, so clientX is the width.
			onResize(clampWidth(event.clientX));
		},
		[onResize],
	);

	const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		dragging.current = false;
		event.currentTarget.releasePointerCapture(event.pointerId);
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
	}, []);

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize sidebar"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			className="absolute inset-y-0 -right-1 z-10 w-2.5 cursor-col-resize transition-colors hover:bg-border-subtle active:bg-border-subtle"
		/>
	);
}

function stripDocExt(name: string): string {
	return name.replace(/\.mdx?$/i, "");
}

function toNavItems(nodes: TreeNode[], activePath: string): NavItem[] {
	return nodes.map((node) => {
		if (node.isDir) {
			return {
				label: node.name,
				items: node.children ? toNavItems(node.children, activePath) : [],
				open: activePath.startsWith(node.path),
			};
		}
		return { label: stripDocExt(node.name), path: node.path };
	});
}

function countDocs(nodes: TreeNode[] | null): number {
	if (!nodes) return 0;
	let count = 0;
	for (const node of nodes) {
		if (node.isDoc) count++;
		if (node.children) count += countDocs(node.children);
	}
	return count;
}

function SidebarBody({
	roots,
	rootDir,
	activePath,
	navigate,
}: {
	roots: RootTree[] | null;
	rootDir: string;
	activePath: string;
	navigate: (path?: string) => void;
}) {
	// A single root keeps today's look (no section title repeating the root
	// name the header link already shows).
	const multiRoot = (roots?.length ?? 0) > 1;
	const sections = useMemo(
		() =>
			(roots ?? []).map((root) => ({
				title: multiRoot ? root.name : undefined,
				items: toNavItems(root.tree, activePath),
			})),
		[roots, activePath, multiRoot],
	);
	const docCount = useMemo(
		() => (roots ?? []).reduce((sum, root) => sum + countDocs(root.tree), 0),
		[roots],
	);

	return (
		<>
			{/* Plain <a>: the router's global click delegation handles navigation. */}
			<a
				href={rootDir ? `${rootDir}/` : "/"}
				title={rootDir}
				className="mb-4 flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[length:var(--size-2xs)] text-text-subtle no-underline hover:bg-surface-hover hover:text-text-heading"
			>
				<Icon name="folder-open" size={13} className="shrink-0" />
				<span className="truncate">{rootDir ? shortenHome(rootDir) : "mdxserve"}</span>
			</a>
			<SidebarNav sections={sections} activePath={activePath} onNavigate={navigate} />
			<div className="mt-8 flex items-center gap-2 border-t border-border-subtle px-2 pt-3 text-[13px] leading-normal font-medium text-text-subtle">
				<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" />
				Watching {docCount} {docCount === 1 ? "file" : "files"}
			</div>
		</>
	);
}

export function Sidebar({
	roots,
	rootDir,
	activePath,
	navigate,
	desktopOpen,
	mobileOpen,
	onCloseMobile,
}: {
	roots: RootTree[] | null;
	rootDir: string;
	activePath: string;
	navigate: (path?: string) => void;
	desktopOpen: boolean;
	mobileOpen: boolean;
	onCloseMobile: () => void;
}) {
	const [width, setWidth] = useAtom(sidebarWidthAtom);

	function handleNavigate(path?: string) {
		onCloseMobile();
		navigate(path);
	}

	return (
		<>
			{/* Mobile overlay: fixed drawer + scrim, closed by default. */}
			<AnimatePresence>
				{mobileOpen ? (
					<motion.div
						key="sidebar-scrim"
						data-print-hide
						{...V.scrim}
						onClick={onCloseMobile}
						className="fixed inset-0 z-[var(--z-scrim)] bg-[var(--scrim)] md:hidden"
					/>
				) : null}
			</AnimatePresence>
			<AnimatePresence>
				{mobileOpen ? (
					<motion.aside
						key="sidebar-panel"
						data-print-hide
						{...V.pop}
						className={
							"fixed inset-y-0 left-0 z-[var(--z-modal)] overflow-y-auto border-r border-border-subtle bg-surface-raised px-3 py-6 shadow-lg md:hidden w-sidebar"
						}
					>
						<SidebarBody
							roots={roots}
							rootDir={rootDir}
							activePath={activePath}
							navigate={handleNavigate}
						/>
					</motion.aside>
				) : null}
			</AnimatePresence>

			{/* Desktop docked column. */}
			{desktopOpen ? (
				<aside
					data-print-hide
					className={"relative hidden md:block " + DOCKED_CLASS}
					style={{ width: clampWidth(width) }}
				>
					<div className="h-full overflow-y-auto px-3 py-6">
						<SidebarBody
							roots={roots}
							rootDir={rootDir}
							activePath={activePath}
							navigate={navigate}
						/>
					</div>
					<ResizeHandle onResize={setWidth} />
				</aside>
			) : null}
		</>
	);
}
