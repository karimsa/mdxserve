import type { TreeNode } from "../listing/tree.js";
import type { DocTreeRoot } from "../listing/controller.js";
import type { SearchResult } from "../search/service.js";
import type { ValidationResult, Diagnostic } from "../validation/validate.js";

export const NO_SERVER_MESSAGE =
	"No mdxserve server is running; start one with `mdxserve serve <dir>`";

export function formatDiagnostic(reportedPath: string, diagnostic: Diagnostic): string {
	const line = diagnostic.line ?? 0;
	const column = diagnostic.column ?? 0;
	const base = `${reportedPath}:${line}:${column}  ${diagnostic.severity}  ${diagnostic.code}  ${diagnostic.message}`;
	if (diagnostic.suggestions && diagnostic.suggestions.length > 0) {
		return `${base}\n    did you mean: ${diagnostic.suggestions.join(", ")}`;
	}
	return base;
}

export function renderStatusLine(result: ValidationResult): string {
	if (result.rendered) return result.ok ? "Rendered OK" : "Rendered with errors";
	// `rendered: false` has three causes; don't blame a missing server for the
	// other two.
	if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
		return "Not rendered (fix the errors above first)";
	}
	return "Not rendered (no mdxserve server is running, or the caller is not on loopback)";
}

export function formatValidationResult(result: ValidationResult): string {
	const lines = result.diagnostics.map((diagnostic) => formatDiagnostic(result.path, diagnostic));
	const renderLine = renderStatusLine(result);
	if (result.diagnostics.length === 0) return [`OK: ${result.path}`, renderLine].join("\n");
	// `ok` only means "no errors" — warnings still need to reach an agent that
	// reads the text rather than the structured output.
	if (result.ok) {
		const warningCount = result.diagnostics.length;
		return [
			`OK with ${warningCount} warning${warningCount === 1 ? "" : "s"}: ${result.path}`,
			...lines,
			renderLine,
		].join("\n");
	}
	return [...lines, renderLine].join("\n");
}

export function formatSearchResults(query: string, results: SearchResult[]): string {
	return results.length === 0
		? `No docs match "${query}".`
		: results.map((result) => `${result.path} — ${result.title}\n    ${result.excerpt}`).join("\n");
}

export function formatDocTree(roots: DocTreeRoot[], dirAbs: string | null): string {
	return roots
		.map((rootEntry) => {
			const body =
				rootEntry.nodes.length === 0 ? "  (no docs)" : indentTree(rootEntry.nodes, 1).join("\n");
			return `${rootEntry.name} (${dirAbs ?? rootEntry.dir})\n${body}`;
		})
		.join("\n\n");
}

export function errorResult(text: string): {
	isError: true;
	content: [{ type: "text"; text: string }];
} {
	return { isError: true, content: [{ type: "text", text }] };
}

export function textResult<Structured extends object>(
	text: string,
	structuredContent: Structured,
): { content: [{ type: "text"; text: string }]; structuredContent: Structured } {
	return { content: [{ type: "text", text }], structuredContent };
}

export function indentTree(nodes: TreeNode[], depth = 0): string[] {
	const lines: string[] = [];
	for (const node of nodes) {
		lines.push(`${"  ".repeat(depth)}${node.isDir ? `${node.name}/` : node.name}`);
		if (node.children) lines.push(...indentTree(node.children, depth + 1));
	}
	return lines;
}
