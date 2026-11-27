/**
 * A server's absolute paths in the app's routes. `listRoots` and `getFolderListing` give paths
 * in the server's own form: `/Users/me/notes` on macOS and Linux, `C:\Users\me\notes` (or a UNC
 * `\\host\share\notes`) on Windows. A route holds a path as its `[...path]` segments, and the
 * segments are turned back into the same form the server gave.
 */

const DRIVE = /^[A-Za-z]:$/;
const UNC_PREFIX = "\\\\";

function isWindowsPath(path: string): boolean {
	return /^[A-Za-z]:([\\/]|$)/.test(path) || path.startsWith(UNC_PREFIX);
}

/** The route segments of an absolute path. A UNC path's first segment keeps its `\\`. */
export function pathSegments(path: string): string[] {
	if (!isWindowsPath(path)) return path.split("/").filter((segment) => segment.length > 0);
	const segments = path.split(/[\\/]+/).filter((segment) => segment.length > 0);
	return path.startsWith(UNC_PREFIX)
		? [`${UNC_PREFIX}${segments[0]}`, ...segments.slice(1)]
		: segments;
}

/** The absolute path a route's `[...path]` segments stand for. */
export function pathFromSegments(segments: string | string[] | undefined): string {
	const list = typeof segments === "string" ? [segments] : (segments ?? []);
	const [first] = list;
	if (first !== undefined && DRIVE.test(first)) {
		return list.length === 1 ? `${first}\\` : list.join("\\");
	}
	if (first?.startsWith(UNC_PREFIX)) return list.join("\\");
	return `/${list.join("/")}`;
}

/** The path of `name` inside the folder `dir`, with the folder's own separator. */
export function childPath(dir: string, name: string): string {
	const separator = isWindowsPath(dir) ? "\\" : "/";
	return `${dir.replace(/[\\/]+$/, "")}${separator}${name}`;
}

/** The last part of a path, for a title; the path itself for a root such as `/` or `C:\`. */
export function baseName(path: string): string {
	return pathSegments(path).at(-1) ?? path;
}
