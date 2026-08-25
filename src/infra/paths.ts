import path from "node:path";

/**
 * Rewrite a filesystem path to forward slashes. Windows paths use `\`, but
 * every consumer of this (Vite's `/@fs/` URLs, `@import`/`@source` lines in
 * generated CSS) expects POSIX-style separators regardless of platform.
 */
export function toPosix(filePath: string): string {
	return filePath.split(path.sep).join("/");
}
