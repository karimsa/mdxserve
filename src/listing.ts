import fs from "node:fs";
import path from "node:path";

export interface ListingEntry {
	name: string;
	isDir: boolean;
	isDoc: boolean;
	size?: number;
}

export interface ListingRoute {
	kind: "listing";
	path: string;
	rootName: string;
	entries: ListingEntry[];
}

const IGNORED_NAMES = new Set(["node_modules"]);

export function isServable(name: string): boolean {
	if (name.startsWith(".")) return false;
	if (IGNORED_NAMES.has(name)) return false;
	return true;
}

/**
 * Read a directory listing for `urlPath` (root-relative, e.g. "/" or
 * "/sub/") within the served directory `root`. Purely data — no HTML.
 */
export function readListing(root: string, urlPath: string): ListingRoute {
	const normalized = urlPath.endsWith("/") ? urlPath : `${urlPath}/`;
	const dirFsPath = path.join(root, normalized);

	const dirents = fs.readdirSync(dirFsPath, { withFileTypes: true });

	const entries: ListingEntry[] = dirents
		.filter((d) => isServable(d.name))
		.map((d) => {
			const isDir = d.isDirectory();
			const ext = path.extname(d.name).toLowerCase();
			const isDoc = !isDir && (ext === ".md" || ext === ".mdx");
			let size: number | undefined;
			if (!isDir) {
				try {
					size = fs.statSync(path.join(dirFsPath, d.name)).size;
				} catch {
					size = undefined;
				}
			}
			return { name: d.name, isDir, isDoc, size };
		})
		.sort((a, b) => {
			if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
			return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
		});

	const rootName = path.basename(root) || root;

	return { kind: "listing", path: normalized, rootName, entries };
}
