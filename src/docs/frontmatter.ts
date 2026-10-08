import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { frontmatter } from "micromark-extension-frontmatter";

/** Body lines using the same YAML syntax extensions as remark-frontmatter. */
export function bodyLines(source: string): string[] {
	const lines = source.split(/\r?\n/);
	// Avoid parsing ordinary documents just to establish that they have no metadata.
	if (!/^\uFEFF?---[\t ]*(?:\r?\n|$)/.test(source)) return lines;
	const tree = fromMarkdown(source, {
		extensions: [frontmatter("yaml")],
		mdastExtensions: [frontmatterFromMarkdown("yaml")],
	});
	const first = tree.children[0];
	return first?.type === "yaml" && first.position ? lines.slice(first.position.end.line) : lines;
}
