import fs from "node:fs";
import path from "node:path";
import { isPublicPath, isServable } from "../roots/servable.js";

// Kept in sync with the Vite watcher's ignore list (see src/rendering/vite.ts) so the
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
	/** Absolute filesystem path; directories end in "/". */
	path: string;
	isDir: boolean;
	isDoc: boolean;
	/** Last modified time, epoch milliseconds. */
	mtime?: number;
	children?: TreeNode[];
}

/**
 * Recursively read the doc tree rooted at the absolute directory `dirAbs`.
 * Only .md/.mdx files and directories that (transitively) contain at least
 * one doc are included. Purely data — no HTML.
 */
export function readTree(dirAbs: string, maxDepth = 8, publicRoot?: string): TreeNode[] {
	function walk(dir: string, depth: number): TreeNode[] {
		let dirents: fs.Dirent[];
		try {
			dirents = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return [];
		}

		const nodes: TreeNode[] = [];
		for (const dirent of dirents) {
			if (!isServable(dirent.name)) continue;
			const abs = path.join(dir, dirent.name);
			if (publicRoot && !isPublicPath(publicRoot, abs)) continue;

			if (dirent.isDirectory()) {
				if (TREE_IGNORED_DIRS.has(dirent.name)) continue;
				if (depth >= maxDepth) continue;
				const children = walk(abs, depth + 1);
				if (children.length === 0) continue;
				let mtime: number | undefined;
				try {
					mtime = fs.statSync(abs).mtimeMs;
				} catch {
					mtime = undefined;
				}
				nodes.push({
					name: dirent.name,
					path: `${abs}/`,
					isDir: true,
					isDoc: false,
					mtime,
					children,
				});
				continue;
			}

			const ext = path.extname(dirent.name).toLowerCase();
			if (ext !== ".md" && ext !== ".mdx") continue;

			let mtime: number | undefined;
			try {
				mtime = fs.statSync(abs).mtimeMs;
			} catch {
				mtime = undefined;
			}
			nodes.push({
				name: dirent.name,
				path: abs,
				isDir: false,
				isDoc: true,
				mtime,
			});
		}

		nodes.sort((first, second) => {
			if (first.isDir !== second.isDir) return first.isDir ? -1 : 1;
			return first.name.localeCompare(second.name, undefined, { sensitivity: "base" });
		});

		return nodes;
	}

	return walk(dirAbs, 0);
}
