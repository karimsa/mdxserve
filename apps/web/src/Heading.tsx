import type { ReactNode } from "react";

/**
 * A section heading. Its `id` is the section's id in the document tree, which
 * is also its URL anchor. h2 to h4 get the hover affordance that links to it
 * (`.mdx-anchor`, styled and positioned by client/design/base/prose.css — it
 * only shows on heading hover or focus).
 */
export function Heading({
	level,
	id,
	className,
	children,
}: {
	level: 1 | 2 | 3 | 4 | 5 | 6;
	id: string;
	className?: string;
	children: ReactNode;
}) {
	const Tag = `h${level}` as const;
	return (
		<Tag id={id} className={className}>
			{children}
			{level >= 2 && level <= 4 ? (
				<a className="mdx-anchor" href={"#" + id} aria-label="Link to this section">
					#
				</a>
			) : null}
		</Tag>
	);
}
