import fsp from "node:fs/promises";
import path from "node:path";
import fs from "node:fs";
import trash from "trash";
import { isServable } from "./listing.js";
import { resolveRoot } from "./paths.js";
import type { MoveDocsToTrashResult } from "./api/schemas.js";

/**
 * Move the given doc files (never directories) under one of `roots` to the OS
 * Trash, so they are recoverable. Moved verbatim from the old
 * `/__mdxserve/api/delete` route handler, with the actual trash call injected
 * as `trashFile` so tests can spy on it without touching the OS trash.
 */
export async function moveDocsToTrash(
	roots: string[],
	paths: string[],
	trashFile: (abs: string) => Promise<void> = (abs) => trash(abs, { glob: false }),
): Promise<MoveDocsToTrashResult> {
	const deleted: string[] = [];
	const failed: { path: string; error: string }[] = [];

	// resolveRoot is string-level only; a directory symlink inside a root
	// could point outside it. Re-check each file's real parent directory
	// against its real root before trashing anything. Cache per root since
	// a batch typically hits the same root many times.
	const realRoots = new Map<string, Promise<string>>();
	function realRoot(root: string): Promise<string> {
		let p = realRoots.get(root);
		if (!p) {
			p = fsp.realpath(root);
			realRoots.set(root, p);
		}
		return p;
	}

	// Serial so a failure attributes to its own path rather than racing
	// with the rest of the batch.
	for (const p of paths) {
		const hit = resolveRoot(roots, p);
		if (!hit || hit.abs === hit.root) {
			failed.push({ path: p, error: "Invalid path" });
			continue;
		}

		// Same servability rule as the listing: dotfiles, node_modules,
		// etc. are never surfaced in the UI, so they can't be deleted
		// through its API either. Checked on the root-relative segments,
		// not the whole absolute path — a root like ~/.config/... would
		// otherwise be undeletable.
		const rel = path.relative(hit.root, hit.abs);
		if (!rel.split("/").filter(Boolean).every(isServable)) {
			failed.push({ path: p, error: "Invalid path" });
			continue;
		}

		try {
			const realRootPath = await realRoot(hit.root);
			const realDir = await fsp.realpath(path.dirname(hit.abs));
			const relReal = path.relative(realRootPath, realDir);
			if (relReal.startsWith("..") || path.isAbsolute(relReal)) {
				failed.push({ path: p, error: "Invalid path" });
				continue;
			}
		} catch {
			failed.push({ path: p, error: "Not found" });
			continue;
		}

		let st: fs.Stats;
		try {
			st = await fsp.lstat(hit.abs);
		} catch {
			failed.push({ path: p, error: "Not found" });
			continue;
		}

		if (st.isDirectory()) {
			failed.push({ path: p, error: "Is a directory" });
			continue;
		}

		try {
			// glob: false — trash expands `*`/`[...]` metacharacters by default,
			// which would let a literal filename like "notes[1].md" match others.
			await trashFile(hit.abs);
			deleted.push(p);
		} catch (error) {
			failed.push({ path: p, error: error instanceof Error ? error.message : String(error) });
		}
	}

	return { deleted, failed };
}
