import type { ComponentType } from "react";
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
};
