import { fromMarkdown } from "mdast-util-from-markdown";
import { mdxFromMarkdown } from "mdast-util-mdx";
import { mdxjs } from "micromark-extension-mdxjs";
import type { Nodes } from "mdast";
import { chartDiagramKeyword, mermaidHeaderLine } from "../../../client/mermaid-chart.js";

export interface MermaidNeeds {
	mermaid: boolean;
	mindmap: boolean;
	math: boolean;
}

function walkMermaidFences(node: Nodes, needs: MermaidNeeds): void {
	if (node.type === "code" && node.lang === "mermaid") {
		// A chart-diagram fence (pie, xychart-beta, quadrantChart, sankey-beta)
		// never reaches mermaid.render (client/Mermaid.tsx short-circuits it), so
		// a doc whose only fences are charts needs no mermaid plugin at all.
		if (chartDiagramKeyword(node.value) === null) {
			needs.mermaid = true;
			// No header at all (e.g. an unclosed frontmatter block) fails open too.
			const header = mermaidHeaderLine(node.value);
			if (header === undefined || header.startsWith("mindmap")) needs.mindmap = true;
			if (node.value.includes("$$")) needs.math = true;
		}
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
