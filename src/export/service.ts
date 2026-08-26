import fsp from "node:fs/promises";
import path from "node:path";
import { getPackageRoot } from "../infra/pkg.js";
import { detectMermaidNeeds } from "../rendering/mdx/detect.js";
import { collectIconNames, listSourceFiles, loadLucideNames } from "../rendering/mdx/icon-names.js";
import { resolveDocPath } from "../roots/paths.js";
import type { BundlePort, MermaidMode } from "../rendering/protocol.js";
import { exportHtml } from "./html.js";

export const EXPORT_FORMATS = ["html"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The mermaid handling modes a build can be asked for; shared by the CLI's `--mermaid` flag and the exportDoc procedure. */
export const MERMAID_MODES = ["cdn", "bundle", "none"] as const satisfies readonly MermaidMode[];

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

export interface BuildInput {
	docPath: string;
	format: ExportFormat;
	/** Defaults to "cdn"; forced to "none" when the doc has no mermaid fence. */
	mermaid?: MermaidMode;
}

export type BuildResult =
	| {
			kind: "ok";
			contents: string;
			/** How `contents` is encoded; a future binary format (PDF) sends base64. */
			encoding: "utf8" | "base64";
			extension: string;
			/** `<basename without .md/.mdx>.<extension>` — never contains a path separator. */
			fileName: string;
			bytes: number;
			warnings: string[];
			mermaid: MermaidMode;
	  }
	| { kind: "not-found"; message: string }
	| { kind: "not-a-doc"; message: string }
	| { kind: "unsupported-format"; message: string }
	| { kind: "bundle-failed"; message: string };

interface FormatOutput {
	contents: string;
	extension: string;
}

function isExportFormat(format: string): format is ExportFormat {
	return (EXPORT_FORMATS as readonly string[]).includes(format);
}

/**
 * Turns one `.md`/`.mdx` file into a single self-contained output file. Owns
 * the work every format shares (resolving the doc, detecting what it needs,
 * running the bundle, formatting the result); a format-specific function does
 * only the final assembly. Constructed per invocation, like
 * `ComponentsService` — there is nothing here to keep warm between calls.
 * `rootDirs` scopes which docs may be reached: the CLI omits it (an
 * absolute path is accepted with no containment, matching its historical
 * behaviour), while the served `exportDoc` procedure passes the mounted
 * roots — possibly none — so a request can only reach a doc inside one of them.
 */
export class ExportService {
	constructor(
		private readonly bundle: BundlePort,
		/**
		 * Omitted: unscoped (the CLI — any absolute path). Given: only docs
		 * inside one of these roots resolve; an empty list resolves nothing,
		 * so a server with no mounted roots stays closed rather than falling
		 * back to the CLI's behaviour.
		 */
		private readonly rootDirs?: string[],
	) {}

	/** Resolve → detect → bundle → format. Never writes to disk. */
	async build(input: BuildInput): Promise<BuildResult> {
		const { docPath, format } = input;

		// The CLI already validates --format against EXPORT_FORMATS; this is
		// defence in depth for any other caller of the service.
		if (!isExportFormat(format)) {
			return {
				kind: "unsupported-format",
				message: `unsupported format "${format}" (supported: ${EXPORT_FORMATS.join(", ")})`,
			};
		}

		// Checked against the caller's input before resolution, so a wrong
		// extension is reported as "not a doc" rather than "not found" even
		// when the file happens to exist under a different name.
		if (!/\.mdx?$/i.test(docPath)) {
			return { kind: "not-a-doc", message: `Not a Markdown/MDX file: ${docPath}` };
		}

		if (this.rootDirs !== undefined && this.rootDirs.length === 0) {
			return { kind: "not-found", message: "No folders are being served" };
		}
		const resolved = await resolveDocPath(this.rootDirs ?? [], docPath);
		if (!resolved.ok) {
			return { kind: "not-found", message: resolved.error };
		}

		const stat = await fsp.stat(resolved.abs);
		const source = await fsp.readFile(resolved.abs, "utf8");
		const needs = detectMermaidNeeds(source);

		const pkgRoot = getPackageRoot();
		// Only the doc itself and mdxserve's own client/ are scanned up front; any
		// local file the doc imports is discovered by the bundle from its module
		// graph and scanned there (src/rendering/bundle.ts). Walking the doc's
		// directory would be wrong twice over: a doc in a large folder (or `~`)
		// would take minutes, and sibling files that aren't imported are noise.
		const sourceFiles = [resolved.abs, ...listSourceFiles(path.join(pkgRoot, "client"))];
		const lucideNames = await loadLucideNames();
		const iconNames = collectIconNames(sourceFiles, lucideNames);

		// A facade/stub for mermaid still costs bytes; skip it entirely when
		// the doc has no fence that could ever call it.
		const mermaidMode: MermaidMode = needs.mermaid ? (input.mermaid ?? "cdn") : "none";

		let bundleOutput;
		try {
			bundleOutput = await this.bundle({
				docPath: resolved.abs,
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
					docPath: resolved.abs,
					mtime: stat.mtimeMs,
					bundle: bundleOutput,
					pkgRoot,
				});
				break;
		}

		const fileName = `${path.basename(resolved.abs).replace(/\.mdx?$/i, "")}.${formatOutput.extension}`;
		const bytes = Buffer.byteLength(formatOutput.contents);

		return {
			kind: "ok",
			contents: formatOutput.contents,
			encoding: "utf8",
			extension: formatOutput.extension,
			fileName,
			bytes,
			warnings: bundleOutput.warnings,
			mermaid: mermaidMode,
		};
	}

	async export(input: ExportInput): Promise<ExportResult> {
		const result = await this.build({
			docPath: input.docPath,
			format: input.format,
			mermaid: input.mermaid,
		});
		if (result.kind !== "ok") return result;

		const outFile = input.outFile ?? path.resolve(process.cwd(), result.fileName);
		await fsp.writeFile(outFile, result.contents);

		return {
			kind: "ok",
			outFile,
			bytes: result.bytes,
			warnings: result.warnings,
			mermaid: result.mermaid,
		};
	}
}
