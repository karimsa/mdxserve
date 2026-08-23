import type { ComponentPropsWithoutRef, ElementType } from "react";

/**
 * MDXProvider `h2`/`h3`/`h4` overrides. `rehype-slug` (see client/entry.tsx)
 * stamps an `id` on every heading it compiles; this factory adds the hover
 * affordance that links to it (`.mdx-anchor`, styled + positioned by
 * client/design/base/prose.css — it only shows up on heading hover or focus).
 * A heading with no `id` (hand-written JSX without rehype-slug) renders
 * without the anchor rather than linking to nothing.
 */
function makeHeading<Level extends "h2" | "h3" | "h4">(tag: Level) {
	// JSX can't use a generic type parameter directly as a tag name; narrow it
	// to `ElementType` once here so `<Tag>` below type-checks as an intrinsic element.
	const Tag = tag as ElementType;
	return function Heading({ id, children, ...rest }: ComponentPropsWithoutRef<Level>) {
		return (
			<Tag id={id} {...rest}>
				{children}
				{id ? (
					<a className="mdx-anchor" href={"#" + id} aria-label="Link to this section">
						#
					</a>
				) : null}
			</Tag>
		);
	};
}

export const H2 = makeHeading("h2");
export const H3 = makeHeading("h3");
export const H4 = makeHeading("h4");
