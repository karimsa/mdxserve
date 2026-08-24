import { Icon } from "../ui/Icon";
import { IconButton } from "../ui/IconButton";
import { Kbd } from "../ui/Kbd";
import type { Theme } from "../theme";

function isApplePlatform(): boolean {
	return /Mac|iPhone|iPod|iPad/.test(navigator.platform);
}

function Wordmark() {
	return (
		<a
			href="/"
			className="flex shrink-0 items-baseline gap-px text-[15px] no-underline [letter-spacing:var(--tracking-tight)]"
		>
			<span className="font-extrabold text-text-heading">mdx</span>
			<span className="font-normal text-text-accent">serve</span>
		</a>
	);
}

export function TopBar({
	sidebarOpen,
	onToggleSidebar,
	onOpenSearch,
	theme,
	onToggleTheme,
}: {
	sidebarOpen: boolean;
	onToggleSidebar: () => void;
	onOpenSearch: () => void;
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
			<IconButton
				icon="panel-left"
				label="Toggle sidebar"
				size="sm"
				active={sidebarOpen}
				onClick={onToggleSidebar}
			/>
			<Wordmark />
			<span className="rounded-sm border border-border-default px-1.5 py-0.5 font-mono text-[length:var(--size-2xs)] text-text-subtle">
				{location.host}
			</span>
			<span className="flex-1" />
			<button
				type="button"
				onClick={onOpenSearch}
				className="flex h-[30px] w-60 items-center gap-2 rounded-md border border-border-default bg-surface-card px-2.5 text-[13px] text-text-subtle shadow-xs cursor-pointer"
			>
				<Icon name="search" size="sm" />
				<span className="flex-1 text-left">Search docs</span>
				<Kbd>{mac ? "⌘K" : "Ctrl K"}</Kbd>
			</button>
			<IconButton
				icon={theme === "dark" ? "sun" : "moon"}
				label={theme === "dark" ? "Light mode" : "Dark mode"}
				size="sm"
				onClick={onToggleTheme}
			/>
		</header>
	);
}
