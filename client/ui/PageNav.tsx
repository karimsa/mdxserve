import { useState, type HTMLAttributes, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Icon } from "./Icon";
import { T } from "../motion";

export interface PageNavLink {
	label: ReactNode;
	href: string;
	/** Overrides the default "Previous" / "Next" eyebrow. */
	eyebrow?: ReactNode;
}

export interface PageNavProps extends HTMLAttributes<HTMLDivElement> {
	prev?: PageNavLink;
	next?: PageNavLink;
}

function Side({ item, dir }: { item: PageNavLink; dir: "prev" | "next" }) {
	const [hover, setHover] = useState(false);
	const prev = dir === "prev";
	return (
		<motion.a
			href={item.href}
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			animate={{ y: hover ? -2 : 0 }}
			whileTap={{ y: 0, scale: 0.995 }}
			transition={T.snap}
			className={
				"flex min-w-0 flex-1 flex-col gap-1 rounded-lg border bg-surface-card px-4 py-3 no-underline transition-shadow " +
				(prev ? "items-start text-left" : "items-end text-right") +
				" " +
				(hover ? "border-border-accent shadow-sm" : "border-border-default")
			}
		>
			<span className="flex items-center gap-1 font-mono text-[length:var(--size-2xs)] font-semibold uppercase tracking-[var(--tracking-caps)] text-text-subtle">
				{prev ? (
					<motion.span animate={{ x: hover ? -2 : 0 }} transition={T.snap} className="inline-flex">
						<Icon name="arrow-left" size={12} />
					</motion.span>
				) : null}
				{item.eyebrow ?? (prev ? "Previous" : "Next")}
				{prev ? null : (
					<motion.span animate={{ x: hover ? 2 : 0 }} transition={T.snap} className="inline-flex">
						<Icon name="arrow-right" size={12} />
					</motion.span>
				)}
			</span>
			<span
				className={
					"max-w-full break-words text-[15px] leading-normal font-semibold transition-colors " +
					(hover ? "text-text-accent" : "text-text-heading")
				}
			>
				{item.label}
			</span>
		</motion.a>
	);
}

/** Prev/next page cards below the prose column. */
export function PageNav({ prev, next, className, ...rest }: PageNavProps) {
	return (
		<div className={"flex gap-3" + (className ? " " + className : "")} {...rest}>
			{prev ? <Side item={prev} dir="prev" /> : <span className="flex-1" />}
			{next ? <Side item={next} dir="next" /> : <span className="flex-1" />}
		</div>
	);
}
