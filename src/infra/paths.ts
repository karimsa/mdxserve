import path from "node:path";

/**
 * Rewrite a filesystem path to forward slashes. Windows paths use `\`, but
 * the paths this returns (a document's root-relative path in a live update)
 * use POSIX-style separators regardless of platform.
 */
export function toPosix(filePath: string): string {
	return filePath.split(path.sep).join("/");
}
