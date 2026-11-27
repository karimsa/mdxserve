import { motion } from "framer-motion";
import { TRANSITIONS } from "../motion";
import { Icon } from "../ui/Icon";
import { type CardProps, type CardGridProps } from "../../shared/builtins/card";

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

const GRID_COLS: Record<NonNullable<CardGridProps["columns"]>, string> = {
	"2": "sm:grid-cols-2",
	"3": "sm:grid-cols-2 lg:grid-cols-3",
};

export function CardGrid({ columns = "2", children }: CardGridProps) {
	return <div className={`not-prose grid grid-cols-1 gap-4 ${GRID_COLS[columns]}`}>{children}</div>;
}
