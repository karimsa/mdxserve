import type { Root, RootContent } from "mdast";
import { unified, type Processor } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import type { Registry } from "../components/registry.js";
import { leadingFrontmatter } from "../docs/frontmatter.js";
import { parseMetadata } from "../docs/metadata.js";
import { builtinPropSchemas } from "@mdxserve/shared/builtins";
import { escapeBareLt } from "./lenient.js";
import { restrictTree } from "./restrict.js";
import { unravelJsxParagraphs } from "./unravel.js";
import { tableIdentities } from "./table-ids.js";
import { convertDocument, type LineRange } from "./convert.js";
import { buildToc } from "./toc.js";
import { splitAtTopHeadings, splitLines } from "./chunks.js";
import { syntaxErrorPlace, type DocumentDiagnostic } from "./diagnostics.js";
import type { FailedChunk } from "./sections.js";
import { DOCUMENT_SCHEMA_VERSION, type DocumentTree } from "./schema.js";

/**
 * Maps an image path written relative to a document to the URL a client
 * loads it from. `docPath` is the path `parse` was given.
 */
export type AssetUrlBuilder = (relativePath: string, docPath: string) => string;

export interface ParseResult {
	tree: DocumentTree;
	/** Every problem found, in line order. Each one has already been repaired in `tree`. */
	diagnostics: DocumentDiagnostic[];
	/** The source lines of each node a reader can edit, by node ID. Never sent to a client. */
	ranges: Map<string, LineRange>;
	/**
	 * The restricted mdast the tree was built from, for the checks
	 * `validate` adds on top (comment anchors, mermaid charts, screenshot
	 * hints) that need source positions. Never sent to a client.
	 */
	mdast: Root;
}

/**
 * Turns a document's source into the tree clients render, the diagnostics
 * `validate` prints and the range table edits use, in one pass. Holds no
 * state between calls; `parse` never throws.
 */
export class DocumentService {
	private readonly processor: Processor<Root>;

	constructor(
		private readonly registry: Registry,
		private readonly assetUrl: AssetUrlBuilder,
	) {
		this.processor = unified()
			.use(remarkParse)
			.use(remarkMdx)
			.use(remarkFrontmatter)
			.use(remarkGfm) as unknown as Processor<Root>;
	}

	parse(source: string, docPath: string): ParseResult {
		try {
			return this.parseSource(source, docPath);
		} catch (error) {
			// Nothing below is expected to throw; if it does, the reader still
			// gets the source and the author a diagnostic rather than a 500.
			return this.unparsed(source, error);
		}
	}

	private parseSource(source: string, docPath: string): ParseResult {
		const diagnostics: DocumentDiagnostic[] = [];
		const report = (diagnostic: DocumentDiagnostic) => diagnostics.push(diagnostic);
		const escaped = escapeBareLt(source, { leadingFrontmatter });
		const root = this.parseWithFallback(source, escaped, report);

		restrictTree(root, {
			components: this.registry.components.map((component) => component.name),
			onDiagnostic: (diagnostic) => report({ severity: "error", ...diagnostic }),
		});
		const tables = tableIdentities(root);
		unravelJsxParagraphs(root);

		const { children, ranges } = convertDocument(root, {
			registry: this.registry,
			propSchemas: builtinPropSchemas,
			assetUrl: (relativePath) => this.assetUrl(relativePath, docPath),
			lineCount: countLines(source),
			tables,
			report,
		});

		const tree: DocumentTree = {
			schemaVersion: DOCUMENT_SCHEMA_VERSION,
			metadata: parseMetadata(source).metadata,
			toc: buildToc(children),
			children,
		};
		return { tree, diagnostics: byLine(diagnostics), ranges, mdast: root };
	}

	/**
	 * Parse the whole source. When that fails, parse each h1/h2 chunk on its
	 * own: the chunks that parse are joined in order, and each one that does
	 * not becomes a failed chunk with an `mdx-syntax` diagnostic. Each chunk is
	 * cut from the original source and escaped on its own, so the bare-`<`
	 * scanner's state (an open `{`, tag or code run) never crosses into the
	 * next section.
	 */
	private parseWithFallback(
		source: string,
		escaped: string,
		report: (diagnostic: DocumentDiagnostic) => void,
	): Root {
		let wholeError: unknown;
		try {
			return this.processor.parse(escaped);
		} catch (error) {
			wholeError = error;
		}

		const originalLines = splitLines(source);
		const frontmatterEnd = leadingFrontmatter(source)?.endLine ?? 0;
		const children: (RootContent | FailedChunk)[] = [];
		let failed = 0;
		for (const chunk of splitAtTopHeadings(source, frontmatterEnd)) {
			// Only the first chunk can start with frontmatter.
			const chunkEscaped = escapeBareLt(
				chunk.text,
				chunk.startLine === 1 ? { leadingFrontmatter } : { leadingFrontmatter: () => undefined },
			);
			// Blank lines in front keep every position in the chunk a file position.
			const padded = "\n".repeat(chunk.startLine - 1) + chunkEscaped;
			try {
				children.push(...this.processor.parse(padded).children);
			} catch (error) {
				failed += 1;
				const { reason, ...at } = syntaxErrorPlace(error);
				// An error at the end of the chunk (an unclosed tag) points one
				// line past it; keep the place inside the section that failed.
				const clamp = (line: number | undefined) =>
					line === undefined ? undefined : Math.min(Math.max(line, chunk.startLine), chunk.endLine);
				const line = clamp(at.line) ?? chunk.startLine;
				report({
					severity: "error",
					code: "mdx-syntax",
					message: `${sentence(reason)} The section starting on line ${chunk.startLine} is shown as source until this is fixed. Fix the syntax at line ${line}.`,
					...at,
					line,
					endLine: clamp(at.endLine),
					...(line !== at.line ? { column: undefined, endColumn: undefined } : {}),
				});
				children.push({
					type: "mdxserveFailedChunk",
					message: reason,
					source: originalLines.slice(chunk.startLine - 1, chunk.endLine).join(""),
					headingText: chunk.headingText,
					level: chunk.level,
					startLine: chunk.startLine,
					endLine: chunk.endLine,
				});
			}
		}
		if (failed === 0) {
			// Each section parses alone but the whole does not, e.g. a tag opened
			// in one section and closed in another: report the whole-document error.
			const { reason, ...at } = syntaxErrorPlace(wholeError);
			report({
				severity: "error",
				code: "mdx-syntax",
				message: `${sentence(reason)} Fix the syntax at line ${at.line ?? 1}.`,
				...at,
			});
		}
		return { type: "root", children: children as RootContent[] };
	}

	private unparsed(source: string, error: unknown): ParseResult {
		const message = error instanceof Error ? error.message : String(error);
		const lineCount = countLines(source);
		const ranges = new Map<string, LineRange>();
		if (lineCount > 0) ranges.set("~error-1", { startLine: 1, endLine: lineCount });
		return {
			tree: {
				schemaVersion: DOCUMENT_SCHEMA_VERSION,
				metadata: { openGraph: [] },
				toc: [],
				children: [{ type: "error", id: "~error-1", message, source }],
			},
			diagnostics: [
				{
					severity: "error",
					code: "mdx-syntax",
					message: `The document could not be read: ${message}`,
					line: 1,
				},
			],
			ranges,
			mdast: { type: "root", children: [] },
		};
	}
}

/**
 * Lines in `text` as `spliceLines` counts them: a trailing line ending ends the last line.
 * @internal Exported for its tests.
 */
export function countLines(text: string): number {
	if (text === "") return 0;
	const lines = text.split(/\r?\n/);
	return /\r?\n$/.test(text) ? lines.length - 1 : lines.length;
}

function byLine(diagnostics: DocumentDiagnostic[]): DocumentDiagnostic[] {
	return diagnostics
		.map((diagnostic, index) => ({ diagnostic, index }))
		.sort(
			(left, right) =>
				(left.diagnostic.line ?? Number.MAX_SAFE_INTEGER) -
					(right.diagnostic.line ?? Number.MAX_SAFE_INTEGER) || left.index - right.index,
		)
		.map(({ diagnostic }) => diagnostic);
}

function sentence(text: string): string {
	return /[.!?]$/.test(text) ? text : `${text}.`;
}
