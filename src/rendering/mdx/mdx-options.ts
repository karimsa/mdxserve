import type { CompileOptions } from "@mdx-js/mdx";
import type { PluggableList } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import { designTokenTheme } from "./shiki-theme.js";

/**
 * The MDX compiler options shared by the Vite dev server and the standalone
 * validator. `extra.remarkPlugins` are appended after `remarkGfm` (e.g. to
 * capture the parsed tree for validation) without disturbing the rest of the
 * pipeline. `extra.rehypePlugins` are appended after `rehypePrettyCode` (e.g.
 * the standalone build's image inliner).
 */
export function mdxCompileOptions(
	extra: { remarkPlugins?: PluggableList; rehypePlugins?: PluggableList } = {},
): CompileOptions {
	return {
		// Treat .md exactly like .mdx: builtin components and JSX work in both.
		// (The default "detect" mode parses .md as plain Markdown and silently
		// drops unknown tags.)
		format: "mdx",
		remarkPlugins: [remarkFrontmatter, remarkGfm, ...(extra.remarkPlugins ?? [])],
		rehypePlugins: [
			// Stable heading ids for the TOC rail and `.mdx-anchor` links.
			rehypeSlug,
			[
				rehypePrettyCode,
				{
					theme: designTokenTheme,
					keepBackground: false,
				},
			],
			...(extra.rehypePlugins ?? []),
		],
		providerImportSource: "@mdx-js/react",
	};
}
