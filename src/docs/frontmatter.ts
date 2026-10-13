import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { frontmatter } from "micromark-extension-frontmatter";

export interface LeadingFrontmatter {
	value: string;
	startLine: number;
	endLine: number;
}

/** The same leading YAML node recognized by remark-frontmatter. */
export function leadingFrontmatter(source: string): LeadingFrontmatter | undefined {
	if (!/^\uFEFF?---[\t ]*(?:\r\n|\r|\n|$)/.test(source)) return undefined;
	const tree = fromMarkdown(source, {
		extensions: [frontmatter("yaml")],
		mdastExtensions: [frontmatterFromMarkdown("yaml")],
	});
	const first = tree.children[0];
	return first?.type === "yaml" && first.position
		? {
				value: first.value,
				startLine: first.position.start.line + 1,
				endLine: first.position.end.line,
			}
		: undefined;
}

/** Body lines using the same YAML syntax extensions as remark-frontmatter. */
export function bodyLines(source: string): string[] {
	const lines = source.split(/\r\n|\r|\n/);
	// Avoid parsing ordinary documents just to establish that they have no metadata.
	if (!/^\uFEFF?---[\t ]*(?:\r\n|\r|\n|$)/.test(source)) return lines;
	const frontmatter = leadingFrontmatter(source);
	return frontmatter ? lines.slice(frontmatter.endLine) : lines;
}
