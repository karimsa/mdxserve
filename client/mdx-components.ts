import type { ComponentType } from "react";
import { MdSection } from "./MdSection";
import { mdxComponentsBase } from "./mdx-components-base";

/**
 * The `MDXProvider` component map shared by both the browser entry
 * (`client/entry.tsx`) and the SSR entry (`client/ssr-entry.tsx`), so the two
 * render paths cannot drift apart.
 */
export const mdxComponents: Record<string, ComponentType<any>> = {
	...mdxComponentsBase,
	// The remark-sections compiler plugin (src/rendering/mdx/remark-sections.ts, server-owned)
	// wraps every editable run of top-level markdown nodes in this synthetic
	// element. It is NOT in the base compile options seen by validate_doc's
	// static registry check (src/rendering/mdx/mdx-options.ts), only in the live Vite config
	// — so it must be registered here (SSR-safe) but never listed as a builtin.
	MdSection,
};
