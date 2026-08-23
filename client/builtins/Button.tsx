import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { T } from "../motion";
import { Icon } from "../ui/Icon";

export const buttonProps = z.object({
	variant: z
		.enum(["primary", "secondary", "ghost", "danger"])
		.default("primary")
		.describe(
			"Visual style: primary (filled teal), secondary (outlined), ghost (text-only), or danger (outlined, danger tone).",
		),
	size: z.enum(["sm", "md", "lg"]).default("md").describe("Height/padding/text size."),
	icon: z.string().optional().describe("Lucide icon name rendered before the label."),
	iconRight: z.string().optional().describe("Lucide icon name rendered after the label."),
	href: z
		.string()
		.optional()
		.describe("If set, renders as a link (`<a>`) instead of a `<button>`."),
	onClick: z.custom<() => void>().optional().describe("Click handler (MDX/JSX only)."),
	disabled: z.boolean().default(false).describe("Disables the button and dims it."),
	children: z.custom<ReactNode>().describe("Button label/content."),
});

export type ButtonProps = z.infer<typeof buttonProps>;

type Variant = NonNullable<ButtonProps["variant"]>;
type Size = NonNullable<ButtonProps["size"]>;

const VARIANT_STYLES: Record<Variant, string> = {
	primary: "bg-teal-550 text-n-0 border border-teal-600 shadow-xs hover:bg-teal-600",
	secondary:
		"bg-surface-card text-text-body border border-border-default shadow-xs hover:bg-surface-hover",
	ghost: "bg-transparent text-text-muted border border-transparent hover:bg-surface-hover",
	danger:
		"bg-surface-card text-status-danger-fg border border-border-default hover:bg-status-danger-bg",
};

const SIZE_STYLES: Record<Size, string> = {
	sm: "h-7 px-2.5 text-[length:var(--size-sm)]",
	md: "h-[34px] px-3.5 text-[length:var(--size-md)]",
	lg: "h-10 px-4.5 text-[length:var(--size-md)]",
};

const ICON_SIZE: Record<Size, "sm" | "md"> = { sm: "sm", md: "md", lg: "md" };

export default function Button({
	variant = "primary",
	size = "md",
	icon,
	iconRight,
	href,
	onClick,
	disabled = false,
	children,
}: ButtonProps) {
	const className = [
		"not-prose inline-flex cursor-pointer items-center justify-center gap-2 rounded-md no-underline",
		"font-sans leading-normal text-[length:var(--size-md)] font-semibold tracking-[var(--tracking-snug)] whitespace-nowrap",
		"transition-colors duration-150",
		"focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus-ring)]",
		"disabled:cursor-not-allowed disabled:opacity-45",
		VARIANT_STYLES[variant],
		SIZE_STYLES[size],
	].join(" ");

	const press = disabled ? undefined : { y: 0.5, scale: 0.988 };
	const iconSize = ICON_SIZE[size];

	const content = (
		<>
			{icon ? <Icon name={icon} size={iconSize} /> : null}
			{children}
			{iconRight ? <Icon name={iconRight} size={iconSize} /> : null}
		</>
	);

	if (href) {
		return (
			<motion.a
				href={disabled ? undefined : href}
				aria-disabled={disabled || undefined}
				whileTap={press}
				transition={T.snap}
				onClick={onClick}
				className={className}
			>
				{content}
			</motion.a>
		);
	}

	return (
		<motion.button
			type="button"
			disabled={disabled}
			whileTap={press}
			transition={T.snap}
			onClick={onClick}
			className={className}
		>
			{content}
		</motion.button>
	);
}
