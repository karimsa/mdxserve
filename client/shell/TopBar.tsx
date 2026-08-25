import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { Kbd } from "../ui/Kbd";
import type { Theme } from "../theme";
import { isApplePlatform } from "../platform";

function Wordmark({ href }: { href?: string }) {
	const content = (
		<>
			<span className="font-extrabold text-text-heading">mdx</span>
			<span className="font-normal text-text-accent">serve</span>
		</>
	);
	if (!href) {
		return <span className="flex shrink-0 items-baseline gap-px text-[15px]">{content}</span>;
	}
	return (
		<a
			href={href}
			className="flex shrink-0 items-baseline gap-px text-[15px] no-underline [letter-spacing:var(--tracking-tight)]"
		>
			{content}
		</a>
	);
}

export function TopBar({
	homeHref,
	hostLabel,
	sidebar,
	search,
	theme,
	onToggleTheme,
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
}) {
	const mac = isApplePlatform();

	return (
		<header
			data-print-hide
			className="sticky top-0 z-10 flex h-topbar shrink-0 items-center gap-3 border-b border-border-subtle px-4"
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
					onClick={sidebar.onToggle}
				/>
			) : null}
			<Wordmark href={homeHref} />
			{hostLabel ? (
				<span className="rounded-sm border border-border-default px-1.5 py-0.5 font-mono text-[length:var(--size-2xs)] text-text-subtle">
					{hostLabel}
				</span>
			) : null}
			<span className="flex-1" />
			{search ? (
				<button
					type="button"
					onClick={search.onOpen}
					className="flex h-[30px] w-60 items-center gap-2 rounded-md border border-border-default bg-surface-card px-2.5 text-[13px] text-text-subtle shadow-xs cursor-pointer"
				>
					<Icon name="search" size="sm" />
					<span className="flex-1 text-left">Search docs</span>
					<Kbd>{mac ? "⌘K" : "Ctrl K"}</Kbd>
				</button>
			) : null}
			<IconButton
				icon={theme === "dark" ? "sun" : "moon"}
				label={theme === "dark" ? "Light mode" : "Dark mode"}
				size="sm"
				onClick={onToggleTheme}
			/>
		</header>
	);
}
