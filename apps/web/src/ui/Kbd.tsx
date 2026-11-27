import type { HTMLAttributes } from "react";

export interface KbdProps extends HTMLAttributes<HTMLElement> {}

/** A single keycap, e.g. inside SearchDialog's "esc" hint. */
export function Kbd({ className, ...rest }: KbdProps) {
	return (
		<kbd
			className={
				"inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-b-2 border-border-default " +
				"bg-surface-card px-[5px] font-mono text-[length:var(--size-2xs)] font-medium text-text-muted" +
				(className ? " " + className : "")
			}
			{...rest}
		/>
	);
}
