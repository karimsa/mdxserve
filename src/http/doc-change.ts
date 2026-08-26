import path from "node:path";
import { resolveRoot } from "../roots/paths.js";
import { isDocFile, isServable } from "../roots/servable.js";
import { rootInfoFor, type RootInfo } from "../roots/root-info.js";
import { toPosix } from "../infra/paths.js";

/** One edited doc, as the `mdxserve:doc-changed` event describes it to the viewer. */
export interface DocChange {
	/** Absolute path of the file that changed. */
	path: string;
	/** Display name of the root it lives in. */
	root: string;
	/** Root-relative posix path — what the reader sees named in the toast. */
	rel: string;
}

/**
 * Maps a watcher "change" event to the doc it edited, or null when the file
 * is not a servable doc inside a mounted root (a component, a dotfile, a
 * stray file outside every root). Pure: takes the live root list so the
 * caller decides how fresh it is.
 */
export function describeDocChange(roots: RootInfo[], changedPath: string): DocChange | null {
	if (!isDocFile(changedPath)) return null;
	const hit = resolveRoot(
		roots.map((info) => info.dir),
		changedPath,
	);
	if (!hit) return null;
	const rel = path.relative(hit.root, hit.abs);
	if (rel === "") return null;
	if (!rel.split(path.sep).every(isServable)) return null;
	return { path: hit.abs, root: rootInfoFor(roots, hit.root).name, rel: toPosix(rel) };
}
