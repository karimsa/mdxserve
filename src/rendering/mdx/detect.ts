import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { mdxjs } from "micromark-extension-mdxjs";
import type { Nodes } from "mdast";

export interface MermaidNeeds {
	mermaid: boolean;
	mindmap: boolean;
	math: boolean;
}

/**
 * The first line of a mermaid fence that names the diagram type: blank lines,
 * `%%` comments/directives, and a leading YAML frontmatter block (`---` …
 * `---`, which mermaid accepts for `title:`/`config:`) are all skipped.
 */
function firstContentLine(text: string): string | undefined {
	const lines = text.split(/\r?\n/).map((rawLine) => rawLine.trim());
	let index = 0;
	while (index < lines.length && lines[index]!.length === 0) index += 1;
	if (lines[index] === "---") {
		const closing = lines.indexOf("---", index + 1);
		if (closing === -1) return undefined;
		index = closing + 1;
	}
	for (; index < lines.length; index += 1) {
		const line = lines[index]!;
		if (line.length === 0 || line.startsWith("%%")) continue;
		return line;
	}
	return undefined;
}

function walkMermaidFences(node: Nodes, needs: MermaidNeeds): void {
	if (node.type === "code" && node.lang === "mermaid") {
		needs.mermaid = true;
		// No header at all (e.g. an unclosed frontmatter block) fails open too.
		const header = firstContentLine(node.value);
		if (header === undefined || header.startsWith("mindmap")) needs.mindmap = true;
		if (node.value.includes("$$")) needs.math = true;
	}
	if ("children" in node && Array.isArray(node.children)) {
		for (const child of node.children as Nodes[]) walkMermaidFences(child, needs);
	}
}

/**
 * Scan `source` for mermaid fences to decide what a "bundle" mode build must
 * ship: elkjs is always stubbed, but cytoscape (`mindmap` diagrams) and katex
 * (`$$` math blocks) only need to work when the doc can actually reach them.
 * Parsed with the same fromMarkdown + mdxjs() + mdxFromMarkdown() stack
 * src/docs/doc-cache.ts uses, so an MDX-flavoured doc parses the same way
 * here as everywhere else.
 */
export function detectMermaidNeeds(source: string): MermaidNeeds {
	const needs: MermaidNeeds = { mermaid: false, mindmap: false, math: false };
	try {
		const root = fromMarkdown(source, {
			extensions: [mdxjs()],
			mdastExtensions: [mdxFromMarkdown()],
		});
		walkMermaidFences(root, needs);
		return needs;
	} catch {
		// Fail open: an unparseable doc still needs to build something usable,
		// so ship every plugin rather than guess wrong and leave one missing.
		return { mermaid: true, mindmap: true, math: true };
	}
}
