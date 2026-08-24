import fsp from "node:fs/promises";
import path from "node:path";
import { spliceLines } from "./edit.js";
import { importResolves } from "./paths.js";
import type { Registry } from "./registry.js";
import { validateSource, type Diagnostic } from "./validate.js";

// A doc above this size isn't a "quick prose fix" candidate; refuse to load
// it into the (in-memory, un-virtualized) Tiptap editor at all.
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export interface DocSource {
	/** The raw on-disk text — not the compiled module, which has been through escapeBareLt/remarkSections. */
	text: string;
	/** mtime (epoch ms) of the file at the moment `text` was read; the save's stale-write guard. */
	mtime: number;
}

export type ReadDocSourceResult =
	{ ok: true; source: DocSource } | { ok: false; kind: "too-large"; size: number };

/**
 * Read a doc's raw source for the per-section editor to seed itself from.
 * "Raw" matters: startLine/endLine from the compiled MdSection props index
 * into the on-disk file, not the transformed one.
 */
export async function readDocSource(abs: string): Promise<ReadDocSourceResult> {
	const stat = await fsp.stat(abs);
	if (stat.size > MAX_SOURCE_BYTES) return { ok: false, kind: "too-large", size: stat.size };
	const text = await fsp.readFile(abs, "utf8");
	return { ok: true, source: { text, mtime: stat.mtimeMs } };
}

// Saves to the same file run one at a time. Two overlapping saves that both
// passed the mtime check could otherwise each read the pre-edit file and
// each write, the second silently discarding the first; chaining them means
// the second re-stats after the first's rename and gets the conflict it should.
const saveQueues = new Map<string, Promise<void>>();
function withSaveLock<Result>(abs: string, task: () => Promise<Result>): Promise<Result> {
	const previous = saveQueues.get(abs) ?? Promise.resolve();
	const run = previous.then(task, task);
	const settled = run.then(
		() => undefined,
		() => undefined,
	);
	saveQueues.set(abs, settled);
	void settled.then(() => {
		if (saveQueues.get(abs) === settled) saveQueues.delete(abs);
	});
	return run;
}

export interface SaveDocSectionInput {
	/** The real (symlink-resolved) absolute path of the doc, already checked to be inside a root. */
	abs: string;
	startLine: number;
	endLine: number;
	/** The mtime the caller read the file at (see `readDocSource`). */
	mtime: number;
	markdown: string;
	registry: Registry;
}

export type SaveDocSectionResult =
	| { ok: true; mtime: number }
	/** The file changed since the caller read it; `mtime` is the current one. */
	| { ok: false; kind: "stale"; mtime: number }
	/** The file has fewer lines than the caller's range expects. */
	| { ok: false; kind: "invalid-range"; error: string }
	/** The spliced file would not compile; nothing was written. */
	| { ok: false; kind: "invalid-doc"; error: string; diagnostics: Diagnostic[] };

/**
 * Write back exactly the line range a section editor was seeded from. mtime
 * is checked against the file the client actually read (not "now"), so an
 * edit made elsewhere between open and save is caught as a conflict instead
 * of silently overwritten; the proposed full-file text is then run through
 * the same validator as validate_doc before anything touches disk, so a save
 * can never leave a doc broken.
 */
export function saveDocSection(input: SaveDocSectionInput): Promise<SaveDocSectionResult> {
	const { abs, startLine, endLine, mtime, markdown, registry } = input;
	return withSaveLock(abs, async () => {
		const stat = await fsp.stat(abs);
		if (stat.mtimeMs !== mtime) return { ok: false, kind: "stale", mtime: stat.mtimeMs };

		const source = await fsp.readFile(abs, "utf8");
		const spliced = spliceLines(source, startLine, endLine, markdown);
		if (!spliced.ok) {
			// The file changed shape (fewer lines than the editor expects) even
			// though mtime matched at the check above — treat it the same as a
			// stale-mtime conflict rather than writing garbage.
			return { ok: false, kind: "invalid-range", error: spliced.error };
		}

		const validation = await validateSource({
			source: spliced.text,
			path: abs,
			registry,
			resolveImport: (specifier) => importResolves(abs, specifier),
		});
		if (!validation.ok) {
			const firstError = validation.diagnostics.find(
				(diagnostic) => diagnostic.severity === "error",
			);
			return {
				ok: false,
				kind: "invalid-doc",
				error: firstError?.message ?? "Validation failed",
				diagnostics: validation.diagnostics,
			};
		}

		// Atomic write: stage in a hidden dotfile next to the target (same
		// directory => same filesystem => rename() is atomic), carry over the
		// original file's mode, then rename over it. The dotfile is also
		// chokidar-ignored (src/vite.ts `server.watch.ignored`), so it never
		// triggers HMR or the listing-changed watcher on its own.
		const tmp = path.join(path.dirname(abs), "." + path.basename(abs) + ".mdxserve-tmp");
		try {
			await fsp.writeFile(tmp, spliced.text, "utf8");
			await fsp.chmod(tmp, stat.mode);
			// Last look before committing: an editor or another process may
			// have written the file while we were validating. Same conflict as
			// the check at the top; the client's mtime is still the one it read.
			const latest = await fsp.stat(abs);
			if (latest.mtimeMs !== mtime) return { ok: false, kind: "stale", mtime: latest.mtimeMs };
			await fsp.rename(tmp, abs);
		} finally {
			await fsp.unlink(tmp).catch(() => {});
		}

		// No websocket push: every root is already on vite.watcher, so the
		// rename above fires chokidar's own "change" event, which drives
		// Vite's HMR and re-renders the doc with fresh MdSection line numbers.
		const finalStat = await fsp.stat(abs);
		return { ok: true, mtime: finalStat.mtimeMs };
	});
}
