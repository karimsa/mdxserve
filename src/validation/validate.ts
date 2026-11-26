import { compile } from "@mdx-js/mdx";
import { VFileMessage } from "vfile-message";
import type { Root, RootContent } from "mdast";
// Importing these types (re-exported from mdast-util-mdx-jsx/mdast-util-mdxjs-esm)
// also pulls in their `declare module "mdast"` augmentations — mdxJsxFlowElement,
// mdxJsxTextElement, mdxjsEsm, ... — so the `RootContent` union above includes them.
import type { MdxJsxAttribute, MdxJsxFlowElement, MdxJsxTextElement } from "mdast-util-mdx";
import type { MetadataPort } from "../docs/metadata-port.js";
import { mdxCompileOptions } from "../rendering/mdx/mdx-options.js";
import { escapeBareLt } from "../document/lenient.js";
import type { RestrictDiagnosticCode } from "../document/restrict.js";
import { suggestFrom, type Registry } from "../components/registry.js";
import type { RenderOutcome } from "../rendering/protocol.js";
import { parseComments } from "../comments/frontmatter.js";
import { anchorDiagnostics } from "../comments/anchor.js";
import { chartDiagramKeyword, chartDiagramMessage } from "../../client/mermaid-chart.js";

export type DiagnosticCode =
	| RestrictDiagnosticCode
	| "mdx-compile"
	| "unknown-prop"
	| "render-error"
	| "mermaid-chart"
	| "frontmatter-metadata"
	| "frontmatter-comments"
	| "comment-anchor";

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
	/** Whether the render step actually ran (a `render` was given and no static error existed). */
	rendered: boolean;
	/**
	 * Advisory guidance for the agent that wrote the doc — things that are not
	 * wrong, but that a builtin would present better. Never affects `ok`.
	 */
	hints: string[];
}

function didYouMean(suggestions: string[]): string {
	return suggestions.length > 0 ? ` Did you mean ${suggestions[0]}?` : "";
}

/**
 * Walk a restricted mdast tree (see `remarkRestrict`) for unrecognized props
 * on builtin components and for mermaid chart blocks. Unknown components are
 * reported by `remarkRestrict`, which unwraps them, so a tag that is not in
 * the registry is skipped here. Pure and synchronous.
 */
export function analyzeTree(tree: Root, registry: Registry): Diagnostic[] {
	const byName = new Map(
		registry.components.map((component) => [component.name, component] as const),
	);
	const diagnostics: Diagnostic[] = [];

	function checkElement(node: MdxJsxFlowElement | MdxJsxTextElement) {
		const name = node.name;
		if (name === null) return; // fragment (<>...</>)
		const entry = byName.get(name);
		if (!entry) return; // a lowercase element, or a tag remarkRestrict reports

		const propNames = Object.keys(
			(entry.props?.properties as Record<string, unknown> | undefined) ?? {},
		);
		const allowed = new Set([...propNames, "children", "key"]);

		for (const attr of node.attributes) {
			if (attr.type !== "mdxJsxAttribute") continue; // skip {...spread} attributes
			if (allowed.has(attr.name)) continue;
			const jsxAttr = attr as MdxJsxAttribute;
			const suggestions = suggestFrom(propNames, jsxAttr.name);
			diagnostics.push({
				severity: "warning",
				code: "unknown-prop",
				message: `Unknown prop "${jsxAttr.name}" on <${name}>.${didYouMean(suggestions)}`,
				line: jsxAttr.position?.start.line ?? node.position?.start.line,
				column: jsxAttr.position?.start.column ?? node.position?.start.column,
				endLine: jsxAttr.position?.end.line ?? node.position?.end.line,
				endColumn: jsxAttr.position?.end.column ?? node.position?.end.column,
				component: name,
				prop: jsxAttr.name,
				suggestions,
			});
		}
	}

	function visit(node: RootContent | Root) {
		if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
			checkElement(node);
		}
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

/** Turn a thrown `compile()` error into a single diagnostic. */
export function fromCompileError(error: unknown): Diagnostic {
	if (error instanceof VFileMessage) {
		let line = error.line;
		let column = error.column;
		let endLine: number | undefined;
		let endColumn: number | undefined;
		const place = error.place;
		if (place && "start" in place) {
			line = line ?? place.start.line;
			column = column ?? place.start.column;
			endLine = place.end?.line;
			endColumn = place.end?.column;
		} else if (place) {
			line = line ?? place.line;
			column = column ?? place.column;
		}
		// Some messages (e.g. mdast-util-mdx-jsx's "end-tag-mismatch" when a tag
		// is left open at EOF, with no matching closer at all) carry no `place`
		// whatsoever — the position is only embedded in the reason text, e.g.
		// "Expected a closing tag for `<Callout>` (1:1-1:10)".
		if (line === undefined) {
			const match = error.reason.match(/\((\d+):(\d+)(?:-(\d+):(\d+))?\)/);
			if (match) {
				line = Number(match[1]);
				column = Number(match[2]);
				if (match[3] !== undefined) {
					endLine = Number(match[3]);
					endColumn = Number(match[4]);
				}
			}
		}
		return {
			severity: "error",
			code: "mdx-compile",
			message: error.reason,
			line,
			column,
			endLine,
			endColumn,
		};
	}
	const message = error instanceof Error ? error.message : String(error);
	return { severity: "error", code: "mdx-compile", message };
}

export interface ValidateSourceInput {
	metadata: MetadataPort;
	source: string;
	path: string;
	registry: Registry;
	/**
	 * Server-side render step, run after static analysis finds no `error`
	 * diagnostic (an unknown component would just throw again with a worse
	 * message). Absent when no mdxserve server is available to render with.
	 */
	render?: (absPath: string) => Promise<RenderOutcome>;
}

/**
 * Compile `source` as MDX and report every document rule it breaks (through
 * the same `remarkRestrict` plugin the renderer runs, so the two cannot
 * drift), unrecognized props on builtins, and (when `render` is given, and
 * only once the doc is otherwise clean) any error thrown while actually
 * rendering it.
 */
export async function validateSource(input: ValidateSourceInput): Promise<ValidationResult> {
	const { path: filePath, registry, render } = input;

	// Both extensions alike. escapeBareLt never adds/removes lines, so `line`
	// stays exact; `column` may drift by a character or two on a line where a
	// `<` got escaped.
	const value = escapeBareLt(input.source, input.metadata);

	let captured: Root | undefined;
	const captureTree = () => (tree: Root) => {
		captured = tree;
	};

	const diagnostics: Diagnostic[] = [];
	const restrict = {
		components: registry.components.map((component) => component.name),
		onDiagnostic: (diagnostic: Omit<Diagnostic, "severity">) =>
			diagnostics.push({ severity: "error", ...diagnostic }),
	};
	try {
		await compile(
			{ value, path: filePath },
			mdxCompileOptions(input.metadata, restrict, { remarkPlugins: [captureTree] }),
		);
		if (captured) diagnostics.push(...analyzeTree(captured, registry));
	} catch (error) {
		diagnostics.push(fromCompileError(error));
	}

	diagnostics.push(...input.metadata.parseMetadata(input.source).diagnostics);
	const comments = parseComments(input.source);
	diagnostics.push(...comments.diagnostics);
	if (captured)
		diagnostics.push(...anchorDiagnostics(captured, comments.threads, comments.positions));

	let rendered = false;
	if (render && !diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
		rendered = true;
		const outcome = await render(filePath);
		if (!outcome.ok) {
			diagnostics.push({
				severity: "error",
				code: "render-error",
				message: outcome.message,
				line: outcome.line,
				column: outcome.column,
			});
		}
	}

	const ok = !diagnostics.some((diagnostic) => diagnostic.severity === "error");
	// A doc that failed to compile has no tree to draw hints from; the compile
	// error is the only thing worth the agent's attention anyway.
	const hints = captured ? collectHints(captured) : [];
	return { ok, path: filePath, diagnostics, rendered, hints };
}
