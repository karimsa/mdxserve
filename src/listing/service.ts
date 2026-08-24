import fsp from "node:fs/promises";
import type { DocCache } from "../docs/doc-cache.js";
import { resolveDirPath, resolveRoot } from "../roots/paths.js";
import { rootInfoFor, type RootInfo } from "../roots/root-info.js";
import { readListing, type FolderListing } from "./folder.js";
import { readTree, type TreeNode } from "./tree.js";

export type FolderListingResult =
	{ kind: "ok"; listing: FolderListing } | { kind: "not-found"; message: string };

export interface DocTreeRoot {
	name: string;
	dir: string;
	nodes: TreeNode[];
}

export type DocTreeResult =
	{ kind: "ok"; roots: DocTreeRoot[]; dirAbs?: string } | { kind: "not-found"; message: string };

/**
 * Resolves and reads folder listings and doc trees for the mounted roots.
 */
export class ListingService {
	constructor(
		private readonly rootInfos: RootInfo[],
		private readonly docCache: DocCache,
	) {}

	/**
	 * Reads the folder listing for the absolute directory `inputPath`. Uses the
	 * same weaker `resolveRoot` + `stat` check the site's directory route has
	 * always used, rather than `resolveDirPath`'s stricter realpath
	 * containment check — unifying the two is a follow-up, not part of this
	 * refactor.
	 */
	async folderListing(inputPath: string): Promise<FolderListingResult> {
		const rootDirs = this.rootInfos.map((rootInfo) => rootInfo.dir);
		const hit = resolveRoot(rootDirs, inputPath);

		let isDirectory = false;
		if (hit) {
			try {
				isDirectory = (await fsp.stat(hit.abs)).isDirectory();
			} catch {
				isDirectory = false;
			}
		}

		if (!hit || !isDirectory) {
			return { kind: "not-found", message: "Not found" };
		}

		return {
			kind: "ok",
			listing: readListing(hit.abs, rootInfoFor(this.rootInfos, hit.root), this.docCache),
		};
	}

	/**
	 * Returns the doc tree of every mounted root when `input.path` is
	 * undefined, or — when given — of the single root that owns that
	 * directory, with `dirAbs` set to the resolved directory.
	 */
	async docTree(input: { path?: string; maxDepth: number }): Promise<DocTreeResult> {
		if (input.path === undefined) {
			return {
				kind: "ok",
				roots: this.rootInfos.map((rootInfo) => ({
					name: rootInfo.name,
					dir: rootInfo.dir,
					nodes: readTree(rootInfo.dir, input.maxDepth),
				})),
			};
		}

		const resolved = await resolveDirPath(
			this.rootInfos.map((rootInfo) => rootInfo.dir),
			input.path,
		);
		if (!resolved.ok) {
			return { kind: "not-found", message: resolved.error };
		}

		const rootInfo = rootInfoFor(this.rootInfos, resolved.root);
		return {
			kind: "ok",
			dirAbs: resolved.abs,
			roots: [
				{
					name: rootInfo.name,
					dir: rootInfo.dir,
					nodes: readTree(resolved.abs, input.maxDepth),
				},
			],
		};
	}
}
