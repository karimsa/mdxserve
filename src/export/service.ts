import fsp from "node:fs/promises";
import path from "node:path";
import { getPackageRoot } from "../infra/pkg.js";
import { detectMermaidNeeds } from "../rendering/mdx/detect.js";
import { collectIconNames, listSourceFiles, loadLucideNames } from "../rendering/mdx/icon-names.js";
import type { BundlePort, MermaidMode } from "../rendering/protocol.js";
import { exportHtml } from "./html.js";

export type ExportFormat = "html";

/** The formats `mdxserve export` currently supports; `src/index.ts` validates `--format` against this and lists it in its error. */
export const EXPORT_FORMATS: readonly ExportFormat[] = ["html"];

export type ExportResult =
	| { kind: "ok"; outFile: string; bytes: number; warnings: string[]; mermaid: MermaidMode }
	| { kind: "not-found"; message: string }
	| { kind: "not-a-doc"; message: string }
	| { kind: "unsupported-format"; message: string }
	| { kind: "bundle-failed"; message: string };

export interface ExportInput {
	docPath: string;
	outFile?: string;
	format: ExportFormat;
	/** Defaults to "cdn"; forced to "none" when the doc has no mermaid fence, regardless of what's passed here. */
	mermaid?: MermaidMode;
}

interface FormatOutput {
	contents: string | Buffer;
	extension: string;
}

function isExportFormat(format: string): format is ExportFormat {
	return (EXPORT_FORMATS as readonly string[]).includes(format);
}

/**
 * Turns one `.md`/`.mdx` file into a single self-contained output file. Owns
 * the work every format shares (resolving the doc, detecting what it needs,
 * running the bundle, writing the result); a format-specific function does
 * only the final assembly. Constructed per invocation, like
 * `ComponentsService` — there is nothing here to keep warm between calls.
 */
export class ExportService {
	constructor(private readonly bundle: BundlePort) {}

	async export(input: ExportInput): Promise<ExportResult> {
		const { docPath, format } = input;

		// The CLI already validates --format against EXPORT_FORMATS; this is
		// defence in depth for any other caller of the service.
		if (!isExportFormat(format)) {
			return {
				kind: "unsupported-format",
				message: `unsupported format "${format}" (supported: ${EXPORT_FORMATS.join(", ")})`,
			};
		}

		let stat;
		try {
			stat = await fsp.stat(docPath);
		} catch {
			return { kind: "not-found", message: `File not found: ${docPath}` };
		}
		if (!stat.isFile()) return { kind: "not-found", message: `Not a file: ${docPath}` };

		if (!/\.mdx?$/i.test(docPath)) {
			return { kind: "not-a-doc", message: `Not a Markdown/MDX file: ${docPath}` };
		}

		const source = await fsp.readFile(docPath, "utf8");
		const needs = detectMermaidNeeds(source);

		const pkgRoot = getPackageRoot();
		// Only the doc itself and mdxserve's own client/ are scanned up front; any
		// local file the doc imports is discovered by the bundle from its module
		// graph and scanned there (src/rendering/bundle.ts). Walking the doc's
		// directory would be wrong twice over: a doc in a large folder (or `~`)
		// would take minutes, and sibling files that aren't imported are noise.
		const sourceFiles = [docPath, ...listSourceFiles(path.join(pkgRoot, "client"))];
		const lucideNames = await loadLucideNames();
		const iconNames = collectIconNames(sourceFiles, lucideNames);

		// A facade/stub for mermaid still costs bytes; skip it entirely when
		// the doc has no fence that could ever call it.
		const mermaidMode: MermaidMode = needs.mermaid ? (input.mermaid ?? "cdn") : "none";

		let bundleOutput;
		try {
			bundleOutput = await this.bundle({
				docPath,
				mermaid: mermaidMode,
				needs: { mindmap: needs.mindmap, math: needs.math },
				iconNames,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { kind: "bundle-failed", message };
		}

		let formatOutput: FormatOutput;
		switch (format) {
			case "html":
				formatOutput = await exportHtml({
					docPath,
					mtime: stat.mtimeMs,
					bundle: bundleOutput,
					pkgRoot,
				});
				break;
		}

		const outFile = input.outFile ?? defaultOutFile(docPath, formatOutput.extension);
		await fsp.writeFile(outFile, formatOutput.contents);
		const bytes = Buffer.byteLength(formatOutput.contents);

		return { kind: "ok", outFile, bytes, warnings: bundleOutput.warnings, mermaid: mermaidMode };
	}
}

function defaultOutFile(docPath: string, extension: string): string {
	const base = path.basename(docPath).replace(/\.mdx?$/i, "");
	return path.resolve(process.cwd(), `${base}.${extension}`);
}
