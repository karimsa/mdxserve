import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Directory holding every per-root cache: `$MDXSERVE_CACHE_HOME` when set
 * (tests point it at a scratch dir), else `$XDG_CACHE_HOME/mdxserve`, else
 * `~/.cache/mdxserve`.
 */
export function getCacheHome(): string {
	const override = process.env.MDXSERVE_CACHE_HOME;
	if (override) return path.resolve(override);
	const xdg = process.env.XDG_CACHE_HOME;
	if (xdg) return path.join(path.resolve(xdg), "mdxserve");
	return path.join(os.homedir(), ".cache", "mdxserve");
}

/**
 * Longest readable prefix kept in a cache key. Filenames cap at 255 bytes on
 * every filesystem we care about; this leaves ample room for the hash suffix.
 */
const MAX_KEY_PREFIX = 64;

/**
 * The path a cache key is derived from: the realpath when `root` exists (served
 * roots are always realpaths, so `cache clean <symlink>` must land on the same
 * folder), else the lexically resolved absolute path.
 */
function canonicalRoot(root: string): string {
	const abs = path.resolve(root);
	try {
		return fs.realpathSync(abs);
	} catch {
		return abs;
	}
}

/**
 * Folder name under the cache home for the directory at `root`: its basename
 * for readability, plus a hash of its canonical absolute path so two roots
 * with the same basename never share a cache.
 */
export function cacheKeyFor(root: string): string {
	const abs = canonicalRoot(root);
	const hash = crypto.createHash("sha256").update(abs).digest("hex").slice(0, 16);
	const base =
		path
			.basename(abs)
			.replace(/[^A-Za-z0-9._-]/g, "_")
			.slice(0, MAX_KEY_PREFIX) || "root";
	return `${base}-${hash}`;
}

/** Directory holding mdxserve's state for `root` (Vite dep cache etc.). */
export function getCacheDir(root: string): string {
	return path.join(getCacheHome(), cacheKeyFor(root));
}

/** Where Vite keeps its pre-bundled dependency cache for `root`. */
export function getViteCacheDir(root: string): string {
	return path.join(getCacheDir(root), "vite");
}

/** Remove the cache directory for `root`. Returns true if something was removed. */
export function cleanCache(root: string): boolean {
	const dir = getCacheDir(root);
	if (!fs.existsSync(dir)) return false;
	fs.rmSync(dir, { recursive: true, force: true });
	return true;
}
