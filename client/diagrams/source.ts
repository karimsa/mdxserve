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
	const opening = original.match(/^(`{3,}|~{3,})[^\n]*(?:\n|$)/);
	if (!opening) return null;
	const lastBreak = original.lastIndexOf("\n");
	const lastLine = original.slice(lastBreak + 1);
	const fence = opening[1];
	const closeMatch = lastLine.match(/^([\t >]*)(`{3,}|~{3,})[\t ]*$/);
	const hasClosing =
		lastBreak >= 0 &&
		closeMatch &&
		closeMatch[2][0] === fence[0] &&
		closeMatch[2].length >= fence.length;
	// Markdown permits fences terminated by EOF or the end of their container.
	// Retain container indentation when adding an explicit closing delimiter.
	const lineStart = markdown.lastIndexOf("\n", start - 1) + 1;
	const openingPrefix = markdown.slice(lineStart, start);
	const prefix = hasClosing
		? closeMatch[1]
		: openingPrefix.replace(/(?:[-+*]|\d+[.)])([ \t]+)/g, (marker) => " ".repeat(marker.length));
	const closing = hasClosing ? lastLine : prefix + fence;
	const openingLine = opening[0].endsWith("\n") ? opening[0] : opening[0] + "\n";
	const trailingNewline = !hasClosing && original.endsWith("\n") ? "\n" : "";
	return {
		source: node.value,
		replace(source: string) {
			const body = source
				.replace(/\r\n/g, "\n")
				.trimEnd()
				.split("\n")
				.map((line) => prefix + line)
				.join("\n");
			return (
				markdown.slice(0, start) +
				openingLine +
				body +
				"\n" +
				closing +
				trailingNewline +
				markdown.slice(end)
			);
		},
	};
}
