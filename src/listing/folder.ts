import fs from "node:fs";
import path from "node:path";
import type { DocCache } from "../docs/doc-cache.js";
import type { RootInfo } from "../roots/root-info.js";
import { isServable } from "../roots/servable.js";

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

export interface FolderListing {
	path: string;
	rootName: string;
	rootDir: string;
	entries: ListingEntry[];
}

/**
 * Read a directory listing for the absolute directory `dirAbs`, which belongs
 * to the mounted root `rootInfo`. Purely data — no HTML.
 */
export function readListing(dirAbs: string, rootInfo: RootInfo, docCache: DocCache): FolderListing {
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
			const doc = isDoc ? docCache.read(absPath, mtime ?? 0) : undefined;
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
		path: `${dirAbs}/`,
		rootName: rootInfo.name,
		rootDir: rootInfo.dir,
		entries,
	};
}
