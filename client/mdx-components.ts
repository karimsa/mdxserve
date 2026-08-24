import type { ComponentType } from "react";
import { MdSection } from "./MdSection";
// This module (and everything it pulls in — every builtin, transitively) is
// reachable from the SSR entry (client/ssr-entry.tsx) that validate_doc's
// render check loads via Vite's SSR module runner. Nothing in this file or
// its dependency graph may import client/router.ts (it touches `window` and
// the query cache at module scope). client/api.ts is the one exception:
// MdSection imports its `trpcClient`, and api.ts is written to evaluate
// without a `window` for exactly that reason — keep it that way, and keep
// every package it imports in src/vite.ts's `ssr.optimizeDeps.include`.
import { TaskCheckbox } from "./TaskCheckbox";
import { Figure, Pre } from "./CodeBlock";
import { H2, H3, H4 } from "./Heading";
import { Table } from "./Table";
import { builtinComponents } from "./builtins/index";

/**
 * The `MDXProvider` component map shared by both the browser entry
 * (`client/entry.tsx`) and the SSR entry (`client/ssr-entry.tsx`), so the two
 * render paths cannot drift apart.
 */
export const mdxComponents: Record<string, ComponentType<any>> = {
	...builtinComponents,
	pre: Pre,
	figure: Figure,
	h2: H2,
	h3: H3,
	h4: H4,
	input: TaskCheckbox,
	table: Table,
	// The remark-sections compiler plugin (src/remark-sections.ts, server-owned)
	// wraps every editable run of top-level markdown nodes in this synthetic
	// element. It is NOT in the base compile options seen by validate_doc's
	// static registry check (src/mdx-options.ts), only in the live Vite config
	// — so it must be registered here (SSR-safe) but never listed as a builtin.
	MdSection,
};
