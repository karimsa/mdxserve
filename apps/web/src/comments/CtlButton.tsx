import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Icon } from "@mdxserve/ui/primitives/Icon";

export interface CtlButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	icon: string;
	/** Accessible name; also the tooltip. */
	label: string;
	/** `resolve` turns green on hover: the checkmark that closes a thread. */
	tone?: "plain" | "resolve";
}

/** The 26px borderless icon button used in thread headers and the panel header. */
export const CtlButton = forwardRef<HTMLButtonElement, CtlButtonProps>(function CtlButton(
	{ icon, label, tone = "plain", className, ...rest },
	ref,
) {
	return (
		<button
			ref={ref}
			type="button"
			aria-label={label}
			title={label}
			className={
				"inline-grid h-[26px] w-[26px] shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-heading disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-text-subtle " +
				(tone === "resolve" ? "hover:bg-status-ok-bg hover:text-status-ok-fg " : "") +
				(className ?? "")
			}
			{...rest}
		>
			<Icon name={icon} size={15} />
		</button>
	);
});
