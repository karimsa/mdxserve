import type { DocCache } from "../docs/doc-cache.js";
import { resolveDirPath } from "../roots/paths.js";
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
	 * Reads the folder listing for the absolute directory `inputPath`.
	 *
	 * Resolution goes through `resolveDirPath` — per-segment servability plus a
	 * realpath containment check — so every caller gets the same answer to "is
	 * this directory servable?". The site's directory route used to do its own
	 * weaker `resolveRoot` + `stat` check, which meant a symlinked directory
	 * pointing out of a root was refused by the API and served by a browser
	 * navigation; both now come through here.
	 */
	async folderListing(inputPath: string): Promise<FolderListingResult> {
		const resolved = await resolveDirPath(
			this.rootInfos.map((rootInfo) => rootInfo.dir),
			inputPath,
		);
		if (!resolved.ok) return { kind: "not-found", message: "Not found" };

		return {
			kind: "ok",
			listing: readListing(resolved.abs, rootInfoFor(this.rootInfos, resolved.root), this.docCache),
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
