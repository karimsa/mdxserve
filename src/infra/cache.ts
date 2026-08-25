import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Directory holding mdxserve's cache state: `$MDXSERVE_CACHE_HOME` when set
 * (tests point it at a scratch dir), else `$XDG_CACHE_HOME/mdxserve`, else
 * `~/.cache/mdxserve`.
 *
 * A single running server now serves a mutable set of roots rather than one
 * fixed root, so there is no longer a per-root cache key: everything lives
 * directly under this one directory.
 */
export function getCacheHome(): string {
	const override = process.env.MDXSERVE_CACHE_HOME;
	if (override) return path.resolve(override);
	const xdg = process.env.XDG_CACHE_HOME;
	if (xdg) return path.join(path.resolve(xdg), "mdxserve");
	return path.join(os.homedir(), ".cache", "mdxserve");
}

/** Where Vite keeps its pre-bundled dependency cache. */
export function getViteCacheDir(): string {
	return path.join(getCacheHome(), "vite");
}

/** Remove the entire cache directory. Returns true if something was removed. */
export function cleanCache(): boolean {
	const dir = getCacheHome();
	if (!fs.existsSync(dir)) return false;
	fs.rmSync(dir, { recursive: true, force: true });
	return true;
}
