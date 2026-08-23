import { useState, type HTMLAttributes } from "react";
import { Icon } from "./Icon";

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
	/** Selected/filtering state. */
	active?: boolean;
	/** Renders a dismiss affordance. */
	onRemove?: () => void;
}

/** Small pill used for filter chips and metadata labels. */
export function Tag({ children, onRemove, active, className, ...rest }: TagProps) {
	const [hover, setHover] = useState(false);
	return (
		<span
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			className={
				"inline-flex h-6 items-center gap-1.5 rounded-pill border font-sans font-medium leading-normal text-[length:var(--size-sm)] transition-colors " +
				(onRemove ? "pr-1.5 pl-2.5" : "px-2.5") +
				" " +
				(active
					? "border-teal-200 bg-surface-accent-soft text-text-accent"
					: hover
						? "border-border-default bg-surface-hover text-text-muted"
						: "border-border-default bg-surface-sunken text-text-muted") +
				(className ? " " + className : "")
			}
			{...rest}
		>
			{children}
			{onRemove ? (
				<button
					type="button"
					onClick={onRemove}
					aria-label="Remove"
					className="inline-flex cursor-pointer rounded-pill border-0 bg-transparent p-0.5 text-inherit"
				>
					<Icon name="x" size={12} />
				</button>
			) : null}
		</span>
	);
}
