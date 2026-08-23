import type { ReactNode } from "react";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { z } from "zod";
import { subtleEase } from "../motion";

export const buttonProps = z.object({
	variant: z
		.enum(["primary", "secondary", "ghost", "danger"])
		.default("primary")
		.describe(
			"Visual style: primary (filled sky), secondary (outlined), ghost (text-only), or danger (filled red).",
		),
	size: z.enum(["sm", "md", "lg"]).default("md").describe("Padding/text size."),
	href: z
		.string()
		.optional()
		.describe("If set, renders as a link (`<a>`) instead of a `<button>`."),
	onClick: z.custom<() => void>().optional().describe("Click handler (MDX/JSX only)."),
	disabled: z.boolean().default(false).describe("Disables the button and dims it."),
	children: z.custom<ReactNode>().describe("Button label/content."),
});

export type ButtonProps = z.infer<typeof buttonProps>;

const variantStyles: Record<NonNullable<ButtonProps["variant"]>, string> = {
	primary: "bg-sky-600 text-white hover:bg-sky-500",
	secondary:
		"bg-white text-gray-900 ring-1 ring-gray-300 hover:bg-gray-50 dark:bg-white/10 dark:text-white dark:ring-white/15",
	ghost: "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10",
	danger: "bg-red-600 text-white hover:bg-red-500",
};

const sizeStyles: Record<NonNullable<ButtonProps["size"]>, string> = {
	sm: "px-2.5 py-1.5 text-xs",
	md: "px-3.5 py-2 text-sm",
	lg: "px-4 py-2.5 text-sm",
};

export default function Button({
	variant = "primary",
	size = "md",
	href,
	onClick,
	disabled = false,
	children,
}: ButtonProps) {
	const controls = useAnimationControls();
	const reducedMotion = useReducedMotion();

	const className = [
		"not-prose inline-flex cursor-pointer items-center gap-1.5 rounded-md font-semibold shadow-xs",
		"outline-sky-600 outline-offset-2 focus-visible:outline-2",
		"disabled:cursor-not-allowed disabled:opacity-50",
		variantStyles[variant],
		sizeStyles[size],
	].join(" ");

	function handleClick() {
		if (disabled) return;
		if (!reducedMotion) {
			controls.start({ scale: [0.96, 1.06, 1], transition: { duration: 0.25, ease: subtleEase } });
		}
		onClick?.();
	}

	if (href) {
		return (
			<motion.a
				href={disabled ? undefined : href}
				aria-disabled={disabled || undefined}
				whileTap={disabled ? undefined : { scale: 0.96 }}
				animate={controls}
				onClick={handleClick}
				className={className}
			>
				{children}
			</motion.a>
		);
	}

	return (
		<motion.button
			type="button"
			disabled={disabled}
			whileTap={disabled ? undefined : { scale: 0.96 }}
			animate={controls}
			onClick={handleClick}
			className={className}
		>
			{children}
		</motion.button>
	);
}
