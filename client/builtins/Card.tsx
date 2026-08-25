import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { TRANSITIONS } from "../motion";
import { Icon } from "../ui/Icon";

export const cardProps = z.object({
	title: z.string().optional().describe("Card heading."),
	description: z.string().optional().describe("One-sentence body text below the title."),
	icon: z.string().optional().describe("Lucide icon name shown above the title."),
	meta: z.string().optional().describe('Small uppercase mono line at the bottom, e.g. "3 pages".'),
	href: z.string().optional().describe("Renders the card as a link and enables the hover lift."),
	interactive: z.boolean().default(false).describe("Enables the hover lift without a link."),
	children: z
		.custom<ReactNode>()
		.optional()
		.describe("Extra content rendered below the description/meta."),
});

export type CardProps = z.infer<typeof cardProps>;

export default function Card({
	title,
	description,
	icon,
	meta,
	href,
	interactive = false,
	children,
}: CardProps) {
	const clickable = interactive || Boolean(href);
	const className = [
		"not-prose group block rounded-lg border p-5 text-text-body no-underline",
		"bg-surface-card transition-shadow duration-150",
		clickable
			? "cursor-pointer border-border-default hover:border-border-accent hover:shadow-sm"
			: "border-border-default",
		"shadow-xs",
	].join(" ");

	const inner = (
		<>
			{icon ? <Icon name={icon} size="lg" className="mb-3 text-text-accent" /> : null}
			{title ? (
				<div className="flex items-center gap-2 font-sans font-semibold leading-[1.4] text-[length:var(--size-md)] text-text-heading">
					<span>{title}</span>
					{clickable ? (
						<span className="inline-flex text-text-subtle opacity-60 transition-[transform,opacity] duration-150 ease-standard group-hover:translate-x-0.5 group-hover:opacity-100">
							<Icon name="arrow-right" size="sm" />
						</span>
					) : null}
				</div>
			) : null}
			{description ? (
				<p className="mt-2 font-sans font-medium text-[length:var(--size-sm)] leading-[1.55] text-text-muted">
					{description}
				</p>
			) : null}
			{meta ? (
				<div className="mt-3 font-mono font-semibold leading-[1.2] text-[length:var(--size-2xs)] uppercase tracking-[var(--tracking-wide)] text-text-subtle">
					{meta}
				</div>
			) : null}
			{children}
		</>
	);

	if (href) {
		return (
			<motion.a
				href={href}
				whileHover={{ y: -2 }}
				whileTap={{ y: 0, scale: 0.995 }}
				transition={TRANSITIONS.snap}
				className={className}
			>
				{inner}
			</motion.a>
		);
	}

	return (
		<motion.div
			whileHover={clickable ? { y: -2 } : undefined}
			whileTap={clickable ? { y: 0, scale: 0.995 } : undefined}
			transition={TRANSITIONS.snap}
			className={className}
		>
			{inner}
		</motion.div>
	);
}

export const cardGridProps = z.object({
	columns: z
		.enum(["2", "3"])
		.default("2")
		.describe("Maximum columns at the widest breakpoint; fewer on narrower screens."),
	children: z.custom<ReactNode>().describe("One or more `<Card>` elements."),
});

export type CardGridProps = z.infer<typeof cardGridProps>;

const GRID_COLS: Record<NonNullable<CardGridProps["columns"]>, string> = {
	"2": "sm:grid-cols-2",
	"3": "sm:grid-cols-2 lg:grid-cols-3",
};

export function CardGrid({ columns = "2", children }: CardGridProps) {
	return <div className={`not-prose grid grid-cols-1 gap-4 ${GRID_COLS[columns]}`}>{children}</div>;
}
