import {
	useEffect,
	useState,
	type HTMLAttributes,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "./Icon";
import { T, V } from "../motion";

export interface NavItem {
	label: ReactNode;
	/** Route this row navigates to; omit for pure groups. */
	path?: string;
	/** Nested rows — presence makes the row collapsible. */
	items?: NavItem[];
	/** Starts expanded unless false. */
	open?: boolean;
	/** Trailing node, usually a Badge. */
	badge?: ReactNode;
}

export interface NavSection {
	title?: ReactNode;
	items?: NavItem[];
}

export interface SidebarNavProps extends HTMLAttributes<HTMLElement> {
	sections?: NavSection[];
	activePath?: string;
	onNavigate?: (path?: string) => void;
}

function Row({
	item,
	activePath,
	onNavigate,
	depth,
}: {
	item: NavItem;
	activePath?: string;
	onNavigate?: (path?: string) => void;
	depth: number;
}) {
	const [open, setOpen] = useState(item.open !== false);
	const hasChildren = Boolean(item.items && item.items.length);
	// `item.open` is recomputed from the active path on every navigation; a
	// group that now contains the active doc reopens even if the reader had
	// collapsed it (deep links, search, prev/next). Closing stays manual.
	useEffect(() => {
		if (item.open) setOpen(true);
	}, [item.open]);
	const active = Boolean(item.path && item.path === activePath);

	const rowClassName =
		"relative flex h-[30px] cursor-pointer items-center gap-2 rounded-md pr-2 text-[13px] leading-normal no-underline transition-colors " +
		(active
			? "font-semibold text-text-accent"
			: "font-medium text-text-muted hover:bg-surface-hover hover:text-text-heading");

	const rowStyle = { paddingLeft: 8 + depth * 12 };

	const content = (
		<>
			{active ? (
				<motion.span
					layoutId="sidebar-active"
					transition={T.glide}
					className="absolute inset-0 z-0 rounded-md bg-surface-accent-soft"
				/>
			) : null}
			<span className="relative z-10 flex min-w-0 flex-1 items-center gap-2">
				{hasChildren ? (
					<motion.span
						animate={{ rotate: open ? 90 : 0 }}
						transition={T.snap}
						className="inline-flex shrink-0 text-text-subtle"
					>
						<Icon name="chevron-right" size={13} />
					</motion.span>
				) : (
					<span className="shrink-0" style={{ width: depth ? 0 : 13 }} />
				)}
				<span className="min-w-0 flex-1 truncate">{item.label}</span>
				{item.badge}
			</span>
		</>
	);

	function toggle() {
		setOpen((current) => !current);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			toggle();
		}
	}

	return (
		<div>
			{hasChildren ? (
				<motion.div
					role="button"
					tabIndex={0}
					aria-expanded={open}
					onClick={toggle}
					onKeyDown={handleKeyDown}
					whileTap={{ scale: 0.99 }}
					transition={T.snap}
					className={rowClassName}
					style={rowStyle}
				>
					{content}
				</motion.div>
			) : (
				<motion.a
					href={item.path}
					onClick={() => onNavigate?.(item.path)}
					whileTap={{ scale: 0.99 }}
					transition={T.snap}
					className={rowClassName}
					style={rowStyle}
				>
					{content}
				</motion.a>
			)}
			<AnimatePresence initial={false}>
				{hasChildren && open ? (
					<motion.div
						{...V.collapse}
						className={
							"overflow-hidden " + (depth === 0 ? "ml-3 border-l border-border-subtle" : "")
						}
					>
						{item.items!.map((child, index) => (
							<Row
								key={index}
								item={child}
								activePath={activePath}
								onNavigate={onNavigate}
								depth={depth + 1}
							/>
						))}
					</motion.div>
				) : null}
			</AnimatePresence>
		</div>
	);
}

/** File-tree navigation for the served folder, rendered into the left rail. */
export function SidebarNav({
	sections = [],
	activePath,
	onNavigate,
	className,
	...rest
}: SidebarNavProps) {
	return (
		<nav className={"flex flex-col gap-6" + (className ? " " + className : "")} {...rest}>
			{sections.map((section, i) => (
				<div key={i} className="flex flex-col gap-0.5">
					{section.title ? (
						<div className="px-2 pb-2 font-mono text-[length:var(--size-2xs)] font-semibold uppercase tracking-[var(--tracking-caps)] text-text-subtle">
							{section.title}
						</div>
					) : null}
					{(section.items ?? []).map((item, j) => (
						<Row key={j} item={item} activePath={activePath} onNavigate={onNavigate} depth={0} />
					))}
				</div>
			))}
		</nav>
	);
}
