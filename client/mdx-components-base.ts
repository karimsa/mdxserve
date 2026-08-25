import type { ComponentType } from "react";
// This module (and everything it pulls in — every builtin, transitively) is
// reachable from the SSR entry (client/ssr-entry.tsx) that validate_doc's
// render check loads via Vite's SSR module runner, and from
// client/standalone-entry.tsx's build output. Nothing in this file or its
// dependency graph may import client/router.ts (it touches `window` and the
// query cache at module scope). client/api.ts is the one exception:
// MdSection imports its `trpcClient`, and api.ts is written to evaluate
// without a `window` for exactly that reason — keep it that way, and keep
// every package it imports in src/rendering/vite.ts's `ssr.optimizeDeps.include`.
import { TaskCheckbox } from "./TaskCheckbox";
import { Figure, Pre } from "./CodeBlock";
import { H2, H3, H4 } from "./Heading";
import { Table } from "./Table";
import { builtinComponents } from "./builtins/index";

/**
 * The `MDXProvider` component map shared by every render path that does not
 * need `MdSection` — the browser entry, the SSR entry, and the standalone
 * build entry. client/mdx-components.ts adds `MdSection` on top for the live
 * server's browser entry.
 */
export const mdxComponentsBase: Record<string, ComponentType<any>> = {
	...builtinComponents,
	pre: Pre,
	figure: Figure,
	h2: H2,
	h3: H3,
	h4: H4,
	input: TaskCheckbox,
	table: Table,
};
