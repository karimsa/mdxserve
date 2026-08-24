import fs from "node:fs";
import path from "node:path";
import { readDoc } from "./doc.js";
import type { RootInfo } from "./shell.js";

export interface ListingEntry {
	name: string;
	isDir: boolean;
	isDoc: boolean;
	/** Plain-text first h1 of the doc, when it has one. */
	title?: string;
	/** The same h1 as inline HTML, for display. */
	titleHtml?: string;
	size?: number;
	/** Last modified time, epoch milliseconds. */
	mtime?: number;
}

export interface ListingRoute {
	kind: "listing";
	path: string;
	rootName: string;
	rootDir: string;
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
export function readTree(dirAbs: string, maxDepth = 8): TreeNode[] {
	function walk(dir: string, depth: number): TreeNode[] {
		let dirents: fs.Dirent[];
		try {
			dirents = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return [];
		}

		const nodes: TreeNode[] = [];
		for (const d of dirents) {
			if (!isServable(d.name)) continue;
			const abs = path.join(dir, d.name);

			if (d.isDirectory()) {
				if (TREE_IGNORED_DIRS.has(d.name)) continue;
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
					name: d.name,
					path: `${abs}/`,
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
				mtime = fs.statSync(abs).mtimeMs;
			} catch {
				mtime = undefined;
			}
			nodes.push({
				name: d.name,
				path: abs,
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

	return walk(dirAbs, 0);
}

/**
 * Read a directory listing for the absolute directory `dirAbs`, which belongs
 * to the mounted root `rootInfo`. Purely data — no HTML.
 */
export function readListing(dirAbs: string, rootInfo: RootInfo): ListingRoute {
	const dirents = fs.readdirSync(dirAbs, { withFileTypes: true });

	const entries: ListingEntry[] = dirents
		.filter((d) => isServable(d.name))
		.map((d) => {
			const isDir = d.isDirectory();
			const ext = path.extname(d.name).toLowerCase();
			const isDoc = !isDir && (ext === ".md" || ext === ".mdx");
			const absPath = path.join(dirAbs, d.name);
			let size: number | undefined;
			let mtime: number | undefined;
			try {
				const stat = fs.statSync(absPath);
				mtime = stat.mtimeMs;
				if (!isDir) size = stat.size;
			} catch {
				size = undefined;
				mtime = undefined;
			}
			const doc = isDoc ? readDoc(absPath, mtime ?? 0) : undefined;
			return {
				name: d.name,
				isDir,
				isDoc,
				title: doc?.h1,
				titleHtml: doc?.h1Html,
				size,
				mtime,
			};
		})
		.sort((a, b) => {
			if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
			return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
		});

	return {
		kind: "listing",
		path: `${dirAbs}/`,
		rootName: rootInfo.name,
		rootDir: rootInfo.dir,
		entries,
	};
}
