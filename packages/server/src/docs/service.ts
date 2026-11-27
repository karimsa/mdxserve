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
import { introducedErrors } from "../validation/introduced.js";
import { DocumentService } from "../document/service.js";
import type { DocumentTree } from "../document/schema.js";
import { assetUrl } from "../assets/url.js";
import type { Diagnostic } from "../validation/validate.js";
import {
	MAX_METADATA_PREFIX_BYTES,
	MAX_YAML_BYTES,
	parseMetadata,
	type DocumentMetadata,
	type MetadataDiagnostic,
} from "./metadata.js";

/**
 * A doc above this size isn't a "quick prose fix" candidate; refuse to load
 * it into the (in-memory, un-virtualized) Tiptap editor at all.
 * @internal Exported for its tests.
 */
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export interface DocSource {
	/** The raw on-disk text, exactly as saved. */
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
 * @internal Exported for its tests.
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

export type LocateDocumentResult =
	| { kind: "ok"; abs: string }
	| { kind: "not-found"; message: string }
	| { kind: "too-large"; size: number };

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

export type ReadNodeSourceResult =
	| { kind: "ok"; markdown: string; version: string }
	| { kind: "not-found"; message: string }
	| { kind: "too-large" };

export interface SaveNodeInput {
	path: string;
	/** The ID of the node to replace, from the document tree the caller read. */
	id: string;
	/** The version token the caller read the file at (see `readDocument`). */
	version: string;
	markdown: string;
}

export type SaveNodeResult =
	| { kind: "ok"; version: string }
	| { kind: "not-found"; message: string }
	/** The file changed since the caller read it; `version` is the current one. */
	| { kind: "stale"; version: string }
	/** The node's line range no longer fits the file. */
	| { kind: "invalid-range"; message: string }
	/** The spliced file has errors the original did not; nothing was written. */
	| { kind: "invalid-doc"; message: string; diagnostics: Diagnostic[] };

type FrontmatterUpdate<Abort> = { kind: "write"; yaml: string } | { kind: "abort"; value: Abort };

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

/**
 * The last line of `range` that an editor sees: a node's range can end in the
 * blank lines that separate it from the next node, and `spliceLines` drops
 * trailing blank lines from what it is given, so saving would otherwise eat
 * the separator. A range of only blank lines is left whole.
 */
function editableEndLine(lines: string[], range: { startLine: number; endLine: number }): number {
	let end = range.endLine;
	while (end > range.startLine && lines[end - 1]?.trim() === "") end -= 1;
	return end;
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
	 * "Raw" matters: the line ranges in the document tree index into the
	 * on-disk file.
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
		const { tree } = new DocumentService(this.registry, assetUrl).parse(read.source.text, read.abs);
		return { kind: "ok", document: tree, version: read.source.version };
	}

	/**
	 * Find the doc `readDocument` would read for `inputPath`, without reading
	 * or parsing it: the same path rules, restricted-mode rules and size limit,
	 * so `ok` here means `readDocument` would succeed for the same caller.
	 * `abs` is the doc's absolute path inside its root, the form the file
	 * watcher reports a change under.
	 */
	async locateDocument(inputPath: string, publicOnly = false): Promise<LocateDocumentResult> {
		const rootDirs = this.roots.list().map((rootInfo) => rootInfo.dir);
		const resolved = await resolveDocPath(rootDirs, inputPath, publicOnly);
		if (!resolved.ok) return { kind: "not-found", message: resolved.error };

		let size: number;
		try {
			size = (await fsp.stat(resolved.abs)).size;
		} catch {
			return { kind: "not-found", message: `${resolved.abs} not found` };
		}
		if (size > MAX_SOURCE_BYTES) return { kind: "too-large", size };
		return { kind: "ok", abs: resolved.abs };
	}

	private async readResolved(
		inputPath: string,
		publicOnly: boolean,
	): Promise<
		| { kind: "ok"; abs: string; source: DocSource }
		| { kind: "not-found"; message: string }
		| { kind: "too-large"; size: number }
	> {
		const located = await this.locateDocument(inputPath, publicOnly);
		if (located.kind !== "ok") return located;
		const text = await fsp.readFile(located.abs, "utf8");
		return { kind: "ok", abs: located.abs, source: { text, version: versionOf(text) } };
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
	 * ignored by the file watcher (`isWatchIgnored` in src/http/watch-signals.ts),
	 * so it never triggers a live update signal on its own.
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
	 * Read the source lines of one node (a section, a tab, a block) by its ID in
	 * the document tree, for an in-place editor to seed itself from. Joined with
	 * "\n" as `spliceLines` counts lines, and without the blank lines that end the
	 * node's range, so saving the text back unchanged reproduces the file.
	 */
	async readNodeSource(
		inputPath: string,
		id: string,
		publicOnly = false,
	): Promise<ReadNodeSourceResult> {
		const read = await this.readResolved(inputPath, publicOnly);
		if (read.kind === "not-found") return read;
		if (read.kind === "too-large") return { kind: "too-large" };
		const { ranges } = new DocumentService(this.registry, assetUrl).parse(
			read.source.text,
			read.abs,
		);
		const range = ranges.get(id);
		if (!range) return { kind: "not-found", message: `No editable node with id "${id}"` };
		const lines = read.source.text.split(/\r?\n/);
		const endLine = editableEndLine(lines, range);
		const markdown = lines.slice(range.startLine - 1, endLine).join("\n");
		return { kind: "ok", markdown, version: read.source.version };
	}

	/**
	 * Replace the lines of one node, found by ID in the file as it is now. The
	 * version token is checked first, against the file the client actually read
	 * (not "now"), so an edit made elsewhere between open and save is caught as
	 * a conflict instead of silently overwritten. The file is validated before
	 * and after the splice and the save is refused only for errors the splice
	 * introduced, so a document that already had an error can still be fixed
	 * one block at a time.
	 */
	async saveNode(input: SaveNodeInput): Promise<SaveNodeResult> {
		const { id, version, markdown } = input;
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

		return this.withSaveLock(abs, async (): Promise<SaveNodeResult> => {
			const stat = await fsp.stat(abs);
			// One read serves the conflict check, the id lookup and the splice, so
			// there is no window between "the bytes I checked" and "the bytes I edited".
			const source = await fsp.readFile(abs, "utf8");
			const current = versionOf(source);
			if (current !== version) return { kind: "stale", version: current };

			const { ranges } = new DocumentService(registry, assetUrl).parse(source, abs);
			const range = ranges.get(id);
			if (!range) return { kind: "not-found", message: `No editable node with id "${id}"` };

			const endLine = editableEndLine(source.split(/\r?\n/), range);
			const spliced = spliceLines(source, range.startLine, endLine, markdown);
			if (!spliced.ok) return { kind: "invalid-range", message: spliced.error };

			const validator = new ValidationService(rootInfos, registry, this);
			const before = await validator.validateText({ source, absPath: abs });
			const after = await validator.validateText({ source: spliced.text, absPath: abs });
			const introduced = introducedErrors(before.diagnostics, after.diagnostics);
			if (introduced.length > 0) {
				return {
					kind: "invalid-doc",
					message: introduced[0]?.message ?? "Validation failed",
					diagnostics: after.diagnostics,
				};
			}

			const written = await this.writeAtomically(abs, stat.mode, spliced.text, version);
			if (written.kind === "stale") return written;

			// No socket push here: every root is on the server's file watcher, so
			// the rename above fires its own "change" event.
			//
			// The new version is the digest of exactly what was written: no
			// re-read needed, and no chance of picking up someone else's write.
			return { kind: "ok", version: versionOf(spliced.text) };
		});
	}
}
