import type { MetadataPort } from "./metadata-port.js";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spliceLines } from "./edit.js";
import { bodyLines, leadingFrontmatter, type LeadingFrontmatter } from "./frontmatter.js";
import { resolveDocPath } from "../roots/paths.js";
import type { RootsService } from "../roots/service.js";
import type { Registry } from "../components/registry.js";
import { ValidationService } from "../validation/service.js";
import { DocumentService } from "../document/service.js";
import type { DocumentTree } from "../document/schema.js";
import { rootFileUrl } from "./asset-url.js";
import type { Diagnostic } from "../validation/validate.js";
import {
	MAX_METADATA_PREFIX_BYTES,
	MAX_YAML_BYTES,
	parseMetadata,
	type DocumentMetadata,
	type MetadataDiagnostic,
} from "./metadata.js";

// A doc above this size isn't a "quick prose fix" candidate; refuse to load
// it into the (in-memory, un-virtualized) Tiptap editor at all.
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export interface DocSource {
	/** The raw on-disk text — not the compiled module, which has been through escapeBareLt/remarkSections. */
	text: string;
	/** Opaque token for the bytes `text` was read from; the save's stale-write guard. */
	version: string;
}

/**
 * A doc's version token: a digest of its exact bytes.
 *
 * mtime is deliberately NOT used here. It reads like the obvious choice, but
 * a filesystem only has to keep timestamps to its own granularity — one
 * second on HFS+, and coarser than a single save on NFS, SMB, and several
 * container overlay filesystems. Two saves inside one such tick leave the
 * mtime bit-identical, so an mtime guard waves the second one through and the
 * editor splices its line range into a file that has already moved underneath
 * it. A content digest cannot miss a change (and, as a bonus, treats an edit
 * that was undone back to the original bytes as no change at all).
 */
export function versionOf(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

export type ReadSourceResult =
	| { kind: "ok"; source: DocSource }
	| { kind: "not-found"; message: string }
	| { kind: "too-large"; size: number };

export type ReadDocumentResult =
	| { kind: "ok"; document: DocumentTree; version: string }
	| { kind: "not-found"; message: string }
	| { kind: "too-large" };

export type ReadMetadataResult =
	| { kind: "ok"; metadata: DocumentMetadata; diagnostics: MetadataDiagnostic[] }
	| { kind: "not-found"; message: string };

function isUnavailableFile(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | null)?.code;
	return (
		code === "ENOENT" ||
		code === "ENOTDIR" ||
		code === "EISDIR" ||
		code === "EACCES" ||
		code === "EPERM"
	);
}

export interface SaveSectionInput {
	path: string;
	startLine: number;
	endLine: number;
	/** The version token the caller read the file at (see `readSource`). */
	version: string;
	markdown: string;
}

export type SaveSectionResult =
	| { kind: "ok"; version: string }
	| { kind: "not-found"; message: string }
	/** The file changed since the caller read it; `version` is the current one. */
	| { kind: "stale"; version: string }
	/** The file has fewer lines than the caller's range expects. */
	| { kind: "invalid-range"; message: string }
	/** The spliced file would not compile; nothing was written. */
	| { kind: "invalid-doc"; message: string; diagnostics: Diagnostic[] };

export type FrontmatterUpdate<Abort> =
	{ kind: "write"; yaml: string } | { kind: "abort"; value: Abort };

export type UpdateFrontmatterResult<Abort> =
	| { kind: "ok"; version: string; source: string }
	| { kind: "not-found"; message: string }
	| { kind: "aborted"; value: Abort }
	| { kind: "too-large" }
	| { kind: "busy" };

export interface UpdateFrontmatterInput<Abort> {
	path: string;
	/** Receives the current leading YAML (undefined when the doc has none) and returns the next one. */
	update: (yaml: string | undefined) => FrontmatterUpdate<Abort>;
}

const MAX_UPDATE_ATTEMPTS = 3;

/** The doc source with only its frontmatter YAML replaced; every body line is untouched. */
function withFrontmatter(source: string, yaml: string): string {
	const eol = /\r\n|\r|\n/.exec(source)?.[0] ?? "\n";
	const yamlLines = yaml.replace(/(?:\r\n|\r|\n)+$/, "");
	const block = yamlLines === "" ? "" : yamlLines.split(/\r\n|\r|\n/).join(eol) + eol;
	const existing = leadingFrontmatter(source);
	if (!existing) {
		const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
		return `${bom}---${eol}${block}---${eol}${source.slice(bom.length)}`;
	}
	// Lines keep their own terminators, so the splice never touches a body byte.
	const lines = source.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
	// startLine is the first YAML line and endLine the closing fence (1-based);
	// an empty block has endLine === startLine, so nothing sits between the fences.
	return [
		...lines.slice(0, existing.startLine - 1),
		block,
		...lines.slice(existing.endLine - 1),
	].join("");
}

/** Owns per-file save locks, so a `DocsService` is per-process state. */
export class DocsService implements MetadataPort {
	/** Parse static metadata from source without reading files or evaluating document code. */
	parseMetadata(
		source: string,
		truncated = false,
	): {
		metadata: DocumentMetadata;
		diagnostics: MetadataDiagnostic[];
	} {
		return parseMetadata(source, truncated);
	}

	/** Locate the leading YAML block using the document's shared frontmatter syntax. */
	leadingFrontmatter(source: string): LeadingFrontmatter | undefined {
		return leadingFrontmatter(source);
	}

	// Saves to the same file run one at a time. Two overlapping saves that both
	// passed the mtime check could otherwise each read the pre-edit file and
	// each write, the second silently discarding the first; chaining them means
	// the second re-stats after the first's rename and gets the conflict it should.
	private readonly saveQueues = new Map<string, Promise<void>>();

	constructor(
		private readonly roots: RootsService,
		private readonly registry: Registry,
	) {}

	private withSaveLock<Result>(abs: string, task: () => Promise<Result>): Promise<Result> {
		const previous = this.saveQueues.get(abs) ?? Promise.resolve();
		const run = previous.then(task, task);
		const settled = run.then(
			() => undefined,
			() => undefined,
		);
		this.saveQueues.set(abs, settled);
		void settled.then(() => {
			if (this.saveQueues.get(abs) === settled) this.saveQueues.delete(abs);
		});
		return run;
	}

	/**
	 * Read a doc's raw source for the per-section editor to seed itself from.
	 * "Raw" matters: startLine/endLine from the compiled MdSection props index
	 * into the on-disk file, not the transformed one.
	 */
	async readSource(inputPath: string, publicOnly = false): Promise<ReadSourceResult> {
		const read = await this.readResolved(inputPath, publicOnly);
		if (read.kind !== "ok") return read;
		return { kind: "ok", source: read.source };
	}

	/**
	 * Read a doc and parse it into the tree a client renders, with the version
	 * token of the bytes it was parsed from. Same path rules and size limit as
	 * `readSource`; an image path relative to the doc becomes the URL the
	 * server serves that file at.
	 */
	async readDocument(inputPath: string, publicOnly = false): Promise<ReadDocumentResult> {
		const read = await this.readResolved(inputPath, publicOnly);
		if (read.kind === "not-found") return read;
		if (read.kind === "too-large") return { kind: "too-large" };
		const { tree } = new DocumentService(this.registry, rootFileUrl).parse(
			read.source.text,
			read.abs,
		);
		return { kind: "ok", document: tree, version: read.source.version };
	}

	private async readResolved(
		inputPath: string,
		publicOnly: boolean,
	): Promise<
		| { kind: "ok"; abs: string; source: DocSource }
		| { kind: "not-found"; message: string }
		| { kind: "too-large"; size: number }
	> {
		const rootDirs = this.roots.list().map((rootInfo) => rootInfo.dir);
		const resolved = await resolveDocPath(rootDirs, inputPath, publicOnly);
		if (!resolved.ok) return { kind: "not-found", message: resolved.error };

		const stat = await fsp.stat(resolved.abs);
		if (stat.size > MAX_SOURCE_BYTES) return { kind: "too-large", size: stat.size };
		const text = await fsp.readFile(resolved.abs, "utf8");
		return { kind: "ok", abs: resolved.abs, source: { text, version: versionOf(text) } };
	}

	/** Read static page metadata without the editor's source-size limit or version hash. */
	async readMetadata(inputPath: string, publicOnly = false): Promise<ReadMetadataResult> {
		const rootDirs = this.roots.list().map((rootInfo) => rootInfo.dir);
		const resolved = await resolveDocPath(rootDirs, inputPath, publicOnly);
		if (!resolved.ok) return { kind: "not-found", message: resolved.error };
		let handle;
		try {
			handle = await fsp.open(resolved.abs, "r");
		} catch (error) {
			if (isUnavailableFile(error))
				return { kind: "not-found", message: `${resolved.abs} not found` };
			throw error;
		}
		try {
			const prefix = Buffer.alloc(MAX_METADATA_PREFIX_BYTES + 1);
			let bytesRead = 0;
			while (bytesRead < prefix.length) {
				const result = await handle.read(prefix, bytesRead, prefix.length - bytesRead, bytesRead);
				if (!result.bytesRead) break;
				bytesRead += result.bytesRead;
			}
			return {
				kind: "ok",
				...this.parseMetadata(
					prefix.subarray(0, bytesRead).toString("utf8"),
					bytesRead > MAX_METADATA_PREFIX_BYTES,
				),
			};
		} catch (error) {
			if (isUnavailableFile(error))
				return { kind: "not-found", message: `${resolved.abs} not found` };
			throw error;
		} finally {
			await handle.close();
		}
	}

	/**
	 * Atomic write: stage in a hidden dotfile next to the target (same
	 * directory => same filesystem => rename() is atomic), carry over the
	 * original file's mode, then rename over it. The dotfile is also
	 * chokidar-ignored (src/rendering/vite.ts `server.watch.ignored`), so it never
	 * triggers HMR or the listing-changed watcher on its own.
	 *
	 * Just before the rename the file is read once more: an editor or another
	 * process may have written it since the caller read it, in which case
	 * nothing is renamed and the current version comes back as `stale`.
	 */
	private async writeAtomically(
		abs: string,
		mode: number,
		text: string,
		expectedVersion: string,
	): Promise<{ kind: "ok" } | { kind: "stale"; version: string }> {
		const tmp = path.join(path.dirname(abs), "." + path.basename(abs) + ".mdxserve-tmp");
		try {
			await fsp.writeFile(tmp, text, "utf8");
			await fsp.chmod(tmp, mode);
			const latest = versionOf(await fsp.readFile(abs, "utf8"));
			if (latest !== expectedVersion) return { kind: "stale", version: latest };
			await fsp.rename(tmp, abs);
		} finally {
			await fsp.unlink(tmp).catch(() => {});
		}
		return { kind: "ok" };
	}

	/**
	 * Rewrite only the leading YAML block of a doc. `update` sees the current
	 * YAML and returns the next one (or aborts); the body lines are guaranteed
	 * byte-identical. This is a read-modify-write of the current file under the
	 * save lock, so it needs no client version; if the file changes underneath
	 * it, the whole cycle runs again, up to three times.
	 */
	async updateFrontmatter<Abort>(
		input: UpdateFrontmatterInput<Abort>,
	): Promise<UpdateFrontmatterResult<Abort>> {
		const rootDirs = this.roots.list().map((rootInfo) => rootInfo.dir);
		const resolved = await resolveDocPath(rootDirs, input.path);
		if (!resolved.ok) return { kind: "not-found", message: resolved.error };
		const abs = await fsp.realpath(resolved.abs);

		return this.withSaveLock(abs, async (): Promise<UpdateFrontmatterResult<Abort>> => {
			for (let attempt = 0; attempt < MAX_UPDATE_ATTEMPTS; attempt++) {
				const stat = await fsp.stat(abs);
				const current = await fsp.readFile(abs, "utf8");
				const update = input.update(leadingFrontmatter(current)?.value);
				if (update.kind === "abort") return { kind: "aborted", value: update.value };

				const next = withFrontmatter(current, update.yaml);
				if (
					Buffer.byteLength(leadingFrontmatter(next)?.value ?? "", "utf8") > MAX_YAML_BYTES ||
					Buffer.byteLength(next, "utf8") > MAX_SOURCE_BYTES
				)
					return { kind: "too-large" };

				const written = leadingFrontmatter(next);
				const wanted = update.yaml.replace(/(?:\r\n|\r|\n)+$/, "");
				const bodyBefore = bodyLines(current);
				// A BOM leads the file, not the body: inserting a block moves it above the opening fence.
				if (!leadingFrontmatter(current) && bodyBefore[0]?.startsWith("\uFEFF"))
					bodyBefore[0] = bodyBefore[0].slice(1);
				const bodyAfter = bodyLines(next);
				if (
					(written?.value.replace(/\r\n|\r/g, "\n") ?? "") !== wanted.replace(/\r\n|\r/g, "\n") ||
					bodyBefore.length !== bodyAfter.length ||
					bodyBefore.some((line, index) => line !== bodyAfter[index])
				)
					throw new Error("updateFrontmatter would change more than the frontmatter");

				const outcome = await this.writeAtomically(abs, stat.mode, next, versionOf(current));
				if (outcome.kind === "ok") return { kind: "ok", version: versionOf(next), source: next };
			}
			return { kind: "busy" };
		});
	}

	/**
	 * Write back exactly the line range a section editor was seeded from. The
	 * version token is checked against the file the client actually read (not
	 * "now"), so an edit made elsewhere between open and save is caught as a
	 * conflict instead of silently overwritten; the proposed full-file text is
	 * then run through the same validator as validate_doc before anything
	 * touches disk, so a save can never leave a doc broken.
	 */
	async saveSection(input: SaveSectionInput): Promise<SaveSectionResult> {
		const { startLine, endLine, version, markdown } = input;
		const registry = this.registry;

		const rootInfos = this.roots.list();
		const rootDirs = rootInfos.map((rootInfo) => rootInfo.dir);
		const resolved = await resolveDocPath(rootDirs, input.path);
		if (!resolved.ok) return { kind: "not-found", message: resolved.error };

		// Write to the real file, not the path the user navigated to: if
		// `input.path` is a symlink, rename() onto it would replace the link
		// itself with a regular file and leave the target untouched.
		// resolveDocPath already checked the realpath stays inside the root.
		const abs = await fsp.realpath(resolved.abs);

		return this.withSaveLock(abs, async () => {
			const stat = await fsp.stat(abs);
			// One read serves both the conflict check and the splice, so there is
			// no window between "the bytes I checked" and "the bytes I edited".
			const source = await fsp.readFile(abs, "utf8");
			const current = versionOf(source);
			if (current !== version) return { kind: "stale", version: current };

			const spliced = spliceLines(source, startLine, endLine, markdown);
			if (!spliced.ok) {
				// The file changed shape (fewer lines than the editor expects) even
				// though the version matched at the check above — treat it the same
				// as a stale-version conflict rather than writing garbage.
				return { kind: "invalid-range", message: spliced.error };
			}

			const validation = await new ValidationService(rootInfos, registry, this).validateText({
				source: spliced.text,
				absPath: abs,
			});
			if (!validation.ok) {
				const firstError = validation.diagnostics.find(
					(diagnostic) => diagnostic.severity === "error",
				);
				return {
					kind: "invalid-doc",
					message: firstError?.message ?? "Validation failed",
					diagnostics: validation.diagnostics,
				};
			}

			const written = await this.writeAtomically(abs, stat.mode, spliced.text, version);
			if (written.kind === "stale") return written;

			// No websocket push: every root is already on vite.watcher, so the
			// rename above fires chokidar's own "change" event, which drives
			// Vite's HMR and re-renders the doc with fresh MdSection line numbers.
			//
			// The new version is the digest of exactly what was written — no
			// re-read needed, and no chance of picking up someone else's write.
			return { kind: "ok", version: versionOf(spliced.text) };
		});
	}
}
