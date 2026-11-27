import { type KbdProps } from "@mdxserve/shared/builtins/kbd";

export default function Kbd({ children }: KbdProps) {
	return (
		<kbd className="not-prose inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-b-2 border-border-default bg-surface-card px-1.5 font-mono leading-[1.62] text-[length:var(--size-2xs)] font-medium text-text-muted">
			{children}
		</kbd>
	);
}
