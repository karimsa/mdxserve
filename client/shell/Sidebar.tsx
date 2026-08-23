import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { V } from "../motion";
import { Icon } from "../ui/Icon";
import { SidebarNav, type NavItem } from "../ui/SidebarNav";
import type { TreeNode } from "../router";

const DOCKED_CLASS =
	"w-sidebar shrink-0 sticky top-topbar h-[calc(100vh-var(--topbar-height))] overflow-y-auto border-r border-border-subtle px-3 py-6";

/** "/Users/karim/foo" -> "~/foo" (best-effort; the client has no direct os.homedir()). */
function shortenHome(dir: string): string {
	const match = dir.match(/^\/(?:Users|home)\/[^/]+/);
	return match ? `~${dir.slice(match[0].length)}` : dir;
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
	tree,
	rootDir,
	activePath,
	navigate,
}: {
	tree: TreeNode[] | null;
	rootDir: string;
	activePath: string;
	navigate: (path?: string) => void;
}) {
	const sections = useMemo(
		() => [{ items: toNavItems(tree ?? [], activePath) }],
		[tree, activePath],
	);
	const docCount = useMemo(() => countDocs(tree), [tree]);

	return (
		<>
			<div className="flex items-center gap-1.5 px-2 pb-4 font-mono text-[length:var(--size-2xs)] text-text-subtle">
				<Icon name="folder-open" size={13} />
				<span className="truncate">{shortenHome(rootDir)}</span>
			</div>
			<SidebarNav sections={sections} activePath={activePath} onNavigate={navigate} />
			<div className="mt-8 flex items-center gap-2 border-t border-border-subtle px-2 pt-3 text-[13px] leading-normal font-medium text-text-subtle">
				<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" />
				Watching {docCount} {docCount === 1 ? "file" : "files"}
			</div>
		</>
	);
}

export function Sidebar({
	tree,
	rootDir,
	activePath,
	navigate,
	desktopOpen,
	mobileOpen,
	onCloseMobile,
}: {
	tree: TreeNode[] | null;
	rootDir: string;
	activePath: string;
	navigate: (path?: string) => void;
	desktopOpen: boolean;
	mobileOpen: boolean;
	onCloseMobile: () => void;
}) {
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
							tree={tree}
							rootDir={rootDir}
							activePath={activePath}
							navigate={handleNavigate}
						/>
					</motion.aside>
				) : null}
			</AnimatePresence>

			{/* Desktop docked column. */}
			{desktopOpen ? (
				<aside data-print-hide className={"hidden md:block " + DOCKED_CLASS}>
					<SidebarBody tree={tree} rootDir={rootDir} activePath={activePath} navigate={navigate} />
				</aside>
			) : null}
		</>
	);
}
