import type { TreeNode } from "../listing/tree.js";
import type { DocTreeRoot } from "../listing/controller.js";
import type { SearchResult } from "../search/service.js";
import type { ValidationResult, Diagnostic } from "../validation/validate.js";

export const NO_SERVER_MESSAGE =
	"No mdxserve server is running; start one with `mdxserve serve -w <dir>`";

export const NO_ROOTS_MESSAGE =
	"The mdxserve server is running but serves no folders yet; add one with `mdxserve roots add <dir>`";

/** @internal Exported for its tests. */
export function formatDiagnostic(reportedPath: string, diagnostic: Diagnostic): string {
	const line = diagnostic.line ?? 0;
	const column = diagnostic.column ?? 0;
	const base = `${reportedPath}:${line}:${column}  ${diagnostic.severity}  ${diagnostic.code}  ${diagnostic.message}`;
	if (diagnostic.suggestions && diagnostic.suggestions.length > 0) {
		return `${base}\n    did you mean: ${diagnostic.suggestions.join(", ")}`;
	}
	return base;
}

export function formatValidationResult(result: ValidationResult): string {
	const lines = result.diagnostics.map((diagnostic) => formatDiagnostic(result.path, diagnostic));
	// Hints are advisory and sit after the verdict, so an agent that reads the
	// text rather than the structured output still sees them without mistaking
	// them for a failure.
	const hintLines = result.hints.map((hint) => `hint: ${hint}`);
	if (result.diagnostics.length === 0) {
		return [`OK: ${result.path}`, ...hintLines].join("\n");
	}
	// `ok` only means "no errors" — warnings still need to reach an agent that
	// reads the text rather than the structured output.
	if (result.ok) {
		const warningCount = result.diagnostics.length;
		return [
			`OK with ${warningCount} warning${warningCount === 1 ? "" : "s"}: ${result.path}`,
			...lines,
			...hintLines,
		].join("\n");
	}
	return [...lines, ...hintLines].join("\n");
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

function indentTree(nodes: TreeNode[], depth = 0): string[] {
	const lines: string[] = [];
	for (const node of nodes) {
		lines.push(`${"  ".repeat(depth)}${node.isDir ? `${node.name}/` : node.name}`);
		if (node.children) lines.push(...indentTree(node.children, depth + 1));
	}
	return lines;
}
