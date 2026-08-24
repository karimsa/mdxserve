import type { ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { MDXProvider } from "@mdx-js/react";
import { mdxComponents } from "./mdx-components";

/**
 * Server-side render of a compiled MDX document's default export, using the
 * exact same `MDXProvider` component map as the browser (`client/entry.tsx`).
 * Used by `src/render.ts` to catch render-time errors (e.g. a bare identifier
 * from a stray MDX expression) that static analysis can't see.
 *
 * No `MotionConfig` here: it only affects animation defaults, which don't
 * matter for a render that's discarded immediately, and dropping it keeps
 * this entry's dependency surface smaller for SSR.
 */
export function renderDoc(Content: ComponentType): string {
	return renderToString(
		<MDXProvider components={mdxComponents}>
			<Content />
		</MDXProvider>,
	);
}
