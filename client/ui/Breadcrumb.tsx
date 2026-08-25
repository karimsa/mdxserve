import { Fragment, type HTMLAttributes, type ReactNode } from "react";
import { Icon } from "./Icon";

export interface BreadcrumbItem {
	label: ReactNode;
	href?: string;
}

export interface BreadcrumbProps extends HTMLAttributes<HTMLElement> {
	items?: BreadcrumbItem[];
}

/** Path trail above the prose column. */
export function Breadcrumb({ items = [], className, ...rest }: BreadcrumbProps) {
	return (
		<nav
			className={
				"flex flex-wrap items-center gap-1.5 text-[13px] leading-normal font-medium text-text-subtle" +
				(className ? " " + className : "")
			}
			{...rest}
		>
			{items.map((item, index) => {
				const last = index === items.length - 1;
				const label =
					last || !item.href ? (
						<span
							className={last ? "font-semibold text-text-body" : "font-medium text-text-subtle"}
						>
							{item.label}
						</span>
					) : (
						<a
							href={item.href}
							className="font-medium text-text-subtle no-underline hover:text-text-heading"
						>
							{item.label}
						</a>
					);
				return (
					<Fragment key={index}>
						{index > 0 ? <Icon name="chevron-right" size={12} className="text-n-300" /> : null}
						{label}
					</Fragment>
				);
			})}
		</nav>
	);
}
