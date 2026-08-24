import fsp from "node:fs/promises";
import path from "node:path";
import { spliceLines } from "./edit.js";
import { resolveDocPath } from "../roots/paths.js";
import type { RootInfo } from "../roots/root-info.js";
import type { Registry } from "../components/registry.js";
import { ValidationService } from "../validation/service.js";
import type { Diagnostic } from "../validation/validate.js";

// A doc above this size isn't a "quick prose fix" candidate; refuse to load
// it into the (in-memory, un-virtualized) Tiptap editor at all.
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export interface DocSource {
	/** The raw on-disk text — not the compiled module, which has been through escapeBareLt/remarkSections. */
	text: string;
	/** mtime (epoch ms) of the file at the moment `text` was read; the save's stale-write guard. */
	mtime: number;
}

export type ReadSourceResult =
	| { kind: "ok"; source: DocSource }
	| { kind: "not-found"; message: string }
	| { kind: "too-large"; size: number };

export interface SaveSectionInput {
	path: string;
	startLine: number;
	endLine: number;
	/** The mtime the caller read the file at (see `readSource`). */
	mtime: number;
	markdown: string;
}

export type SaveSectionResult =
	| { kind: "ok"; mtime: number }
	| { kind: "not-found"; message: string }
	/** The file changed since the caller read it; `mtime` is the current one. */
	| { kind: "stale"; mtime: number }
	/** The file has fewer lines than the caller's range expects. */
	| { kind: "invalid-range"; message: string }
	/** The spliced file would not compile; nothing was written. */
	| { kind: "invalid-doc"; message: string; diagnostics: Diagnostic[] };

/** Owns per-file save locks, so a `DocsService` is per-process state. */
export class DocsService {
	// Saves to the same file run one at a time. Two overlapping saves that both
	// passed the mtime check could otherwise each read the pre-edit file and
	// each write, the second silently discarding the first; chaining them means
	// the second re-stats after the first's rename and gets the conflict it should.
	private readonly saveQueues = new Map<string, Promise<void>>();

	constructor(
		private readonly rootInfos: RootInfo[],
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
	async readSource(inputPath: string): Promise<ReadSourceResult> {
		const rootDirs = this.rootInfos.map((rootInfo) => rootInfo.dir);
		const resolved = await resolveDocPath(rootDirs, inputPath);
		if (!resolved.ok) return { kind: "not-found", message: resolved.error };

		const stat = await fsp.stat(resolved.abs);
		if (stat.size > MAX_SOURCE_BYTES) return { kind: "too-large", size: stat.size };
		const text = await fsp.readFile(resolved.abs, "utf8");
		return { kind: "ok", source: { text, mtime: stat.mtimeMs } };
	}

	/**
	 * Write back exactly the line range a section editor was seeded from. mtime
	 * is checked against the file the client actually read (not "now"), so an
	 * edit made elsewhere between open and save is caught as a conflict instead
	 * of silently overwritten; the proposed full-file text is then run through
	 * the same validator as validate_doc before anything touches disk, so a save
	 * can never leave a doc broken.
	 */
	async saveSection(input: SaveSectionInput): Promise<SaveSectionResult> {
		const { startLine, endLine, mtime, markdown } = input;
		const registry = this.registry;

		const rootDirs = this.rootInfos.map((rootInfo) => rootInfo.dir);
		const resolved = await resolveDocPath(rootDirs, input.path);
		if (!resolved.ok) return { kind: "not-found", message: resolved.error };

		// Write to the real file, not the path the user navigated to: if
		// `input.path` is a symlink, rename() onto it would replace the link
		// itself with a regular file and leave the target untouched.
		// resolveDocPath already checked the realpath stays inside the root.
		const abs = await fsp.realpath(resolved.abs);

		return this.withSaveLock(abs, async () => {
			const stat = await fsp.stat(abs);
			if (stat.mtimeMs !== mtime) return { kind: "stale", mtime: stat.mtimeMs };

			const source = await fsp.readFile(abs, "utf8");
			const spliced = spliceLines(source, startLine, endLine, markdown);
			if (!spliced.ok) {
				// The file changed shape (fewer lines than the editor expects) even
				// though mtime matched at the check above — treat it the same as a
				// stale-mtime conflict rather than writing garbage.
				return { kind: "invalid-range", message: spliced.error };
			}

			const validation = await new ValidationService(this.rootInfos, registry).validateText({
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

			// Atomic write: stage in a hidden dotfile next to the target (same
			// directory => same filesystem => rename() is atomic), carry over the
			// original file's mode, then rename over it. The dotfile is also
			// chokidar-ignored (src/rendering/vite.ts `server.watch.ignored`), so it never
			// triggers HMR or the listing-changed watcher on its own.
			const tmp = path.join(path.dirname(abs), "." + path.basename(abs) + ".mdxserve-tmp");
			try {
				await fsp.writeFile(tmp, spliced.text, "utf8");
				await fsp.chmod(tmp, stat.mode);
				// Last look before committing: an editor or another process may
				// have written the file while we were validating. Same conflict as
				// the check at the top; the client's mtime is still the one it read.
				const latest = await fsp.stat(abs);
				if (latest.mtimeMs !== mtime) return { kind: "stale", mtime: latest.mtimeMs };
				await fsp.rename(tmp, abs);
			} finally {
				await fsp.unlink(tmp).catch(() => {});
			}

			// No websocket push: every root is already on vite.watcher, so the
			// rename above fires chokidar's own "change" event, which drives
			// Vite's HMR and re-renders the doc with fresh MdSection line numbers.
			const finalStat = await fsp.stat(abs);
			return { kind: "ok", mtime: finalStat.mtimeMs };
		});
	}
}
