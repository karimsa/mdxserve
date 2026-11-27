import type { Root, RootContent } from "mdast";
import type { MetadataPort } from "../docs/metadata-port.js";
import { DocumentService } from "../document/service.js";
import { DOCUMENT_DIAGNOSTIC_CODES } from "../document/diagnostics.js";
import { assetUrl } from "../assets/url.js";
import type { Registry } from "../components/registry.js";
import { parseComments } from "../comments/frontmatter.js";
import { anchorDiagnostics } from "../comments/anchor.js";
import { chartDiagramKeyword, chartDiagramMessage } from "@mdxserve/shared/mermaid-chart";

/** Every code `mdxserve validate` reports: the document's own, then the checks layered on top. */
export const DIAGNOSTIC_CODES = [
	...DOCUMENT_DIAGNOSTIC_CODES,
	"mermaid-chart",
	"frontmatter-metadata",
	"frontmatter-comments",
	"comment-anchor",
] as const;

type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export interface Diagnostic {
	severity: "error" | "warning";
	code: DiagnosticCode;
	message: string;
	line?: number;
	column?: number;
	endLine?: number;
	endColumn?: number;
	component?: string;
	prop?: string;
	suggestions?: string[];
}

export interface ValidationResult {
	ok: boolean;
	path: string;
	diagnostics: Diagnostic[];
	/**
	 * Advisory guidance for the agent that wrote the doc — things that are not
	 * wrong, but that a builtin would present better. Never affects `ok`.
	 */
	hints: string[];
}

/**
 * `mermaid-chart` errors for mermaid blocks that draw a chart the `<Chart>`
 * builtin draws better. Reads the restricted mdast `DocumentService.parse`
 * returns, for the source position of each block. Pure and synchronous.
 * @internal Exported for its tests.
 */
export function analyzeTree(tree: Root): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];

	function visit(node: RootContent | Root) {
		if (node.type === "code" && node.lang === "mermaid") {
			const keyword = chartDiagramKeyword(node.value);
			if (keyword !== null) {
				diagnostics.push({
					severity: "error",
					code: "mermaid-chart",
					message: chartDiagramMessage(keyword),
					line: node.position?.start.line,
					column: node.position?.start.column,
					endLine: node.position?.end.line,
					endColumn: node.position?.end.column,
				});
			}
		}
		if ("children" in node && Array.isArray(node.children)) {
			for (const child of node.children as RootContent[]) visit(child);
		}
	}

	visit(tree);
	return diagnostics;
}

/** Alt text or path mentioning "screen" (screenshot, screen-recording, login-screen, …). */
const SCREEN_WORD = /screen/i;

/**
 * Collect advisory hints from the mdast tree. Today there is one: Markdown
 * images whose alt text or path mention "screen" are probably screenshots,
 * which the `<Screenshot>` builtin frames better than a bare `<img>`. Pure
 * and synchronous, like `analyzeTree`.
 * @internal Exported for its tests.
 */
export function collectHints(tree: Root): string[] {
	const screenshotLines: number[] = [];

	function visit(node: RootContent | Root) {
		if (node.type === "image" && (SCREEN_WORD.test(node.alt ?? "") || SCREEN_WORD.test(node.url))) {
			const line = node.position?.start.line;
			if (line !== undefined) screenshotLines.push(line);
		}
		if ("children" in node && Array.isArray(node.children)) {
			for (const child of node.children as RootContent[]) visit(child);
		}
	}

	visit(tree);

	const hints: string[] = [];
	if (screenshotLines.length > 0) {
		const where =
			screenshotLines.length === 1
				? `Line ${screenshotLines[0]} has a Markdown image that looks`
				: `Lines ${screenshotLines.join(", ")} have Markdown images that look`;
		hints.push(
			`${where} like a screenshot (the alt text or path mentions "screen"). Consider the <Screenshot src alt title caption> builtin for screenshots: it frames the image as a macOS window with an expand view that pans and zooms. Run \`mdxserve components show Screenshot\` for the props.`,
		);
	}
	return hints;
}

export interface ValidateSourceInput {
	metadata: MetadataPort;
	source: string;
	path: string;
	registry: Registry;
}

/**
 * Parse `source` with `DocumentService.parse`, the same function that builds
 * the tree a reader gets, and report its diagnostics; then add the checks
 * that only matter to an author: frontmatter metadata and comments, comment
 * anchors, mermaid charts and screenshot hints.
 */
export async function validateSource(input: ValidateSourceInput): Promise<ValidationResult> {
	const { path: filePath, registry } = input;

	const parsed = new DocumentService(registry, assetUrl).parse(input.source, filePath);
	const diagnostics: Diagnostic[] = [...parsed.diagnostics];
	// A section that failed to parse has no tree to check; its syntax error is
	// the only thing worth the author's attention there.
	const parsedFully = !parsed.diagnostics.some((diagnostic) => diagnostic.code === "mdx-syntax");
	diagnostics.push(...analyzeTree(parsed.mdast));

	diagnostics.push(...input.metadata.parseMetadata(input.source).diagnostics);
	const comments = parseComments(input.source);
	diagnostics.push(...comments.diagnostics);
	if (parsedFully)
		diagnostics.push(...anchorDiagnostics(parsed.mdast, comments.threads, comments.positions));

	const ok = !diagnostics.some((diagnostic) => diagnostic.severity === "error");
	const hints = parsedFully ? collectHints(parsed.mdast) : [];
	return { ok, path: filePath, diagnostics, hints };
}
