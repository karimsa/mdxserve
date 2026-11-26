import type { MetadataPort } from "../../docs/metadata-port.js";
import type { CompileOptions } from "@mdx-js/mdx";
import type { PluggableList } from "unified";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { remarkTableIds } from "./remark-table-ids.js";
import { remarkMetadata } from "./remark-metadata.js";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import { designTokenTheme } from "./shiki-theme.js";
import { remarkRestrict, type RestrictOptions } from "../../document/restrict.js";

/**
 * The MDX compiler options shared by the Vite dev server and the validator. `restrict` configures the document rules (`remarkRestrict`),
 * which run right after `remarkGfm` so every later plugin, the compiler and
 * the validator all see the same restricted tree. `extra.remarkPlugins` are
 * appended after the rest of the remark chain (e.g. to capture the parsed
 * tree for validation) without disturbing the rest of the
 * pipeline. `extra.rehypePlugins` are appended after `rehypePrettyCode`.
 */
export function mdxCompileOptions(
	metadata: MetadataPort,
	restrict: RestrictOptions,
	extra: { remarkPlugins?: PluggableList; rehypePlugins?: PluggableList } = {},
): CompileOptions {
	return {
		// Treat .md exactly like .mdx: builtin components and JSX work in both.
		// (The default "detect" mode parses .md as plain Markdown and silently
		// drops unknown tags.)
		format: "mdx",
		remarkPlugins: [
			remarkFrontmatter,
			remarkGfm,
			[remarkRestrict, restrict],
			remarkTableIds,
			[remarkMetadata, metadata],
			...(extra.remarkPlugins ?? []),
		],
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
