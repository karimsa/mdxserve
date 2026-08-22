import fs from "node:fs";
import path from "node:path";

/** Per-served-directory state lives in a hidden folder at the root being served. */
export const CACHE_DIR_NAME = ".mdxserve";

/** Directory holding mdxserve's state for `root` (Vite dep cache etc.). */
export function getCacheDir(root: string): string {
  return path.join(root, CACHE_DIR_NAME);
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
