import { fromMarkdown } from "mdast-util-from-markdown";
import type { Code, RootContent } from "mdast";
import type { ExistingDiagram } from "./edit-context";

// Syntax highlighting pads empty lines for display; those spaces aren't edits.
export function comparableSource(source: string): string {
	return source
		.replace(/\r\n/g, "\n")
		.replace(/^[\t ]+$/gm, "")
		.trim();
}

/** Locate the original fence without round-tripping the surrounding Markdown. */
export function locateDiagram(markdown: string, target: ExistingDiagram) {
	const diagrams: Code[] = [];
	function visit(node: RootContent): void {
		if (node.type === "code" && node.lang === "mermaid") diagrams.push(node);
		if ("children" in node) for (const child of node.children) visit(child as RootContent);
	}
	for (const node of fromMarkdown(markdown).children) visit(node);
	const node = diagrams[target.index];
	const start = node?.position?.start.offset;
	const end = node?.position?.end.offset;
	if (
		!node ||
		start === undefined ||
		end === undefined ||
		comparableSource(node.value) !== comparableSource(target.source)
	)
		return null;
	const original = markdown.slice(start, end);
	const opening = original.match(/^(`{3,}|~{3,})[^\n]*\n/);
	if (!opening) return null;
	const lastBreak = original.lastIndexOf("\n");
	const closing = original.slice(lastBreak + 1);
	const fence = opening[1];
	const closeMatch = closing.match(/^([\t >]*)(`{3,}|~{3,})[\t ]*$/);
	if (!closeMatch || closeMatch[2][0] !== fence[0] || closeMatch[2].length < fence.length)
		return null;
	const prefix = closeMatch[1];
	return {
		source: node.value,
		replace(source: string) {
			const body = source
				.replace(/\r\n/g, "\n")
				.trimEnd()
				.split("\n")
				.map((line) => prefix + line)
				.join("\n");
			return markdown.slice(0, start) + opening[0] + body + "\n" + closing + markdown.slice(end);
		},
	};
}
