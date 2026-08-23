import fs from "node:fs";
import path from "node:path";

export interface ListingEntry {
	name: string;
	isDir: boolean;
	isDoc: boolean;
	size?: number;
	/** Last modified time, epoch milliseconds. */
	mtime?: number;
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

// Kept in sync with the Vite watcher's ignore list (see src/vite.ts) so the
// tree never surfaces directories we don't watch for changes.
const TREE_IGNORED_DIRS = new Set([
	".git",
	"node_modules",
	".mdxserve",
	".venv",
	"venv",
	".cache",
	"dist",
	"build",
	"target",
	"__pycache__",
]);

export interface TreeNode {
	name: string;
	/** Root-relative URL path; directories end in "/". */
	path: string;
	isDir: boolean;
	isDoc: boolean;
	/** Last modified time, epoch milliseconds. */
	mtime?: number;
	children?: TreeNode[];
}

/**
 * Recursively read the doc tree rooted at `urlPath` within the served
 * directory `root`. Only .md/.mdx files and directories that (transitively)
 * contain at least one doc are included. Purely data — no HTML.
 */
export function readTree(root: string, urlPath = "/", maxDepth = 8): TreeNode[] {
	function walk(dirUrlPath: string, depth: number): TreeNode[] {
		const normalized = dirUrlPath.endsWith("/") ? dirUrlPath : `${dirUrlPath}/`;
		const dirFsPath = path.join(root, normalized);

		let dirents: fs.Dirent[];
		try {
			dirents = fs.readdirSync(dirFsPath, { withFileTypes: true });
		} catch {
			return [];
		}

		const nodes: TreeNode[] = [];
		for (const d of dirents) {
			if (!isServable(d.name)) continue;

			if (d.isDirectory()) {
				if (TREE_IGNORED_DIRS.has(d.name)) continue;
				if (depth >= maxDepth) continue;
				const childUrlPath = `${normalized}${d.name}/`;
				const children = walk(childUrlPath, depth + 1);
				if (children.length === 0) continue;
				let mtime: number | undefined;
				try {
					mtime = fs.statSync(path.join(dirFsPath, d.name)).mtimeMs;
				} catch {
					mtime = undefined;
				}
				nodes.push({
					name: d.name,
					path: childUrlPath,
					isDir: true,
					isDoc: false,
					mtime,
					children,
				});
				continue;
			}

			const ext = path.extname(d.name).toLowerCase();
			if (ext !== ".md" && ext !== ".mdx") continue;

			let mtime: number | undefined;
			try {
				mtime = fs.statSync(path.join(dirFsPath, d.name)).mtimeMs;
			} catch {
				mtime = undefined;
			}
			nodes.push({
				name: d.name,
				path: `${normalized}${d.name}`,
				isDir: false,
				isDoc: true,
				mtime,
			});
		}

		nodes.sort((a, b) => {
			if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
			return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
		});

		return nodes;
	}

	return walk(urlPath, 0);
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
			let mtime: number | undefined;
			try {
				const stat = fs.statSync(path.join(dirFsPath, d.name));
				mtime = stat.mtimeMs;
				if (!isDir) size = stat.size;
			} catch {
				size = undefined;
				mtime = undefined;
			}
			return { name: d.name, isDir, isDoc, size, mtime };
		})
		.sort((a, b) => {
			if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
			return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
		});

	const rootName = path.basename(root) || root;

	return { kind: "listing", path: normalized, rootName, entries };
}
