import { Icon } from "@mdxserve/ui/primitives/Icon";
import { IconButton } from "../ui/IconButton";
import { Kbd } from "../ui/Kbd";
import type { Theme } from "../theme";
import { isApplePlatform } from "../platform";
import { Wordmark } from "@mdxserve/ui/brand/Wordmark";

export function TopBar({
	homeHref,
	hostLabel,
	sidebar,
	search,
	theme,
	onToggleTheme,
	onDiagramPreferences,
	comments,
	toc,
}: {
	/** Wordmark's link target; undefined renders it as a plain (non-link) span. */
	homeHref?: string;
	/** Host chip shown next to the wordmark; omitted when undefined. */
	hostLabel?: string;
	/** Sidebar toggle button; omitted when undefined. */
	sidebar?: { open: boolean; onToggle: () => void };
	/** Search button; omitted when undefined. */
	search?: { onOpen: () => void };
	theme: Theme;
	onToggleTheme: () => void;
	onDiagramPreferences?: () => void;
	/** Brings out the table of contents where it is not on the page; omitted when undefined. */
	toc?: { onOpen: () => void; className: string };
	/** Comments panel toggle (doc pages); omitted when undefined. */
	comments?: { count: number; open: boolean; onToggle: () => void };
}) {
	const mac = isApplePlatform();

	return (
		<header
			data-print-hide
			className="sticky top-0 z-10 flex h-topbar shrink-0 items-center gap-1 border-b border-border-subtle px-2 md:gap-3 md:px-4 [&>button]:max-md:h-11 [&>button]:max-md:w-11 [&>button]:shrink-0"
			style={{
				background: "color-mix(in oklab, var(--surface-page) 82%, transparent)",
				backdropFilter: "var(--blur-chrome)",
			}}
		>
			{sidebar ? (
				<IconButton
					icon="panel-left"
					label="Toggle sidebar"
					size="sm"
					active={sidebar.open}
					// No grey flash on tap in mobile Safari.
					className="[-webkit-tap-highlight-color:transparent]"
					onClick={sidebar.onToggle}
				/>
			) : null}
			<Wordmark href={homeHref} />
			{hostLabel ? (
				<span
					title={hostLabel}
					className="hidden min-w-0 max-w-48 truncate md:block rounded-sm border border-border-default px-1.5 py-0.5 font-mono text-[length:var(--size-2xs)] text-text-subtle"
				>
					{hostLabel}
				</span>
			) : null}
			<span className="flex-1" />
			{search ? (
				<button
					type="button"
					onClick={search.onOpen}
					aria-label="Search docs"
					title="Search docs"
					className="flex h-11 w-11 shrink-0 justify-center md:h-[30px] md:w-60 md:justify-start items-center gap-2 rounded-md border border-border-default bg-surface-card px-2.5 text-[13px] text-text-subtle shadow-xs cursor-pointer max-md:border-transparent max-md:bg-transparent max-md:text-text-muted max-md:shadow-none max-md:[-webkit-tap-highlight-color:transparent] max-md:active:bg-surface-hover"
				>
					<Icon name="search" size="sm" />
					<span className="hidden md:block flex-1 text-left">Search docs</span>
					<span className="hidden md:contents">
						<Kbd>{mac ? "⌘K" : "Ctrl K"}</Kbd>
					</span>
				</button>
			) : null}
			{toc ? (
				<IconButton
					icon="table-of-contents"
					label="On this page"
					size="sm"
					className={toc.className}
					onClick={toc.onOpen}
				/>
			) : null}
			{comments ? (
				<span className="relative inline-flex shrink-0">
					<IconButton
						icon="message-square"
						label={comments.count > 0 ? `Comments (${comments.count} open)` : "Comments"}
						size="sm"
						active={comments.open}
						className="max-md:h-11 max-md:w-11"
						onClick={comments.onToggle}
					/>
					{comments.count > 0 ? (
						<span
							aria-hidden
							className="pointer-events-none absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-pill bg-surface-accent px-1 text-[10px] font-semibold leading-none text-n-0 tabular-nums"
						>
							{comments.count > 99 ? "99+" : comments.count}
						</span>
					) : null}
				</span>
			) : null}
			{onDiagramPreferences && (
				<IconButton icon="settings" label="Settings" size="sm" onClick={onDiagramPreferences} />
			)}
			<IconButton
				icon={theme === "dark" ? "sun" : "moon"}
				label={theme === "dark" ? "Light mode" : "Dark mode"}
				size="sm"
				onClick={onToggleTheme}
			/>
		</header>
	);
}
