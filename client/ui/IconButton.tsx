import { forwardRef, type ButtonHTMLAttributes } from "react";
import { motion, type MotionProps } from "framer-motion";
import { Icon } from "./Icon";
import { T } from "../motion";

const BOX: Record<"sm" | "md" | "lg", string> = {
	sm: "h-[26px] w-[26px]",
	md: "h-8 w-8",
	lg: "h-[38px] w-[38px]",
};

// `motion.button` redefines a handful of DOM event props (onAnimationStart,
// onDrag*…) with its own signatures; omitting their DOM versions here is what
// lets `{...rest}` below flow straight onto it without a type clash.
export interface IconButtonProps extends Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	keyof MotionProps
> {
	/** Lucide icon name. */
	icon: string;
	size?: "sm" | "md" | "lg";
	variant?: "ghost" | "outline";
	/** Sticky pressed state, e.g. an enabled sidebar toggle. */
	active?: boolean;
	/** Accessible name — also used as the native tooltip. */
	label?: string;
}

/** Small square control for chrome: sidebar toggle, code copy, diagram zoom. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
	{ icon, size = "md", variant = "ghost", active, label, disabled, className, ...rest },
	ref,
) {
	const bordered = variant === "outline";
	return (
		<motion.button
			ref={ref}
			type="button"
			aria-label={label}
			title={label}
			disabled={disabled}
			whileTap={disabled ? undefined : { scale: 0.92 }}
			transition={T.snap}
			className={
				"inline-flex items-center justify-center rounded-md cursor-pointer transition-colors " +
				"disabled:cursor-not-allowed disabled:opacity-45 " +
				BOX[size] +
				" " +
				(bordered ? "border border-border-default" : "border border-transparent") +
				" " +
				(active
					? "bg-surface-active text-text-heading"
					: bordered
						? "bg-surface-card text-text-muted hover:bg-surface-hover"
						: "text-text-muted hover:bg-surface-hover") +
				(className ? " " + className : "")
			}
			{...rest}
		>
			<Icon name={icon} size={size === "sm" ? "sm" : "md"} />
		</motion.button>
	);
});
