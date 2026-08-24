import type { HTMLAttributes, ReactNode } from "react";
import { motion } from "framer-motion";
import { T } from "../motion";

export interface TocItem {
	id: string;
	label: ReactNode;
	/** Heading level, 2-4. */
	level?: number;
}

// `title` shadows the native HTML tooltip attribute (typed `string` on `HTMLAttributes`).
export interface TocListProps extends Omit<HTMLAttributes<HTMLElement>, "title" | "onSelect"> {
	items?: TocItem[];
	/** id of the heading currently in view. */
	activeId?: string;
	onSelect?: (id: string) => void;
	/** Set to null to hide the label. */
	title?: ReactNode;
}

/** "On this page" rail, kept in sync with scroll position by the caller via `activeId`. */
export function TocList({
	items = [],
	activeId,
	onSelect,
	title = "On this page",
	className,
	...rest
}: TocListProps) {
	return (
		<nav className={"flex flex-col gap-2" + (className ? " " + className : "")} {...rest}>
			{title ? (
				<div className="font-mono text-[length:var(--size-2xs)] font-semibold uppercase tracking-[var(--tracking-caps)] text-text-subtle">
					{title}
				</div>
			) : null}
			<div className="relative flex flex-col">
				{items.map((item) => {
					const active = item.id === activeId;
					return (
						<a
							key={item.id}
							href={"#" + item.id}
							onClick={(event) => {
								if (onSelect) {
									event.preventDefault();
									onSelect(item.id);
								}
							}}
							className={
								"relative block break-words border-l-2 border-border-default py-[5px] text-[13px] leading-normal no-underline transition-colors " +
								(active ? "font-semibold text-text-accent" : "font-normal text-text-muted")
							}
							style={{ paddingLeft: 10 + ((item.level ?? 2) - 2) * 12 }}
						>
							{active ? (
								<motion.span
									layoutId="toc-active"
									transition={T.glide}
									className="absolute -left-0.5 top-0 bottom-0 w-0.5 bg-teal-500"
								/>
							) : null}
							{item.label}
						</a>
					);
				})}
			</div>
		</nav>
	);
}
