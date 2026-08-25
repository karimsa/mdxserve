import fsp from "node:fs/promises";
import path from "node:path";
import { computeRootInfos, isInside, pruneNestedRoots, type RootInfo } from "./root-info.js";

export type AdmitRootsResult =
	| { kind: "ok"; roots: string[]; rootInfos: RootInfo[] }
	| { kind: "not-found"; message: string }
	| { kind: "not-a-directory"; message: string }
	/** Serving `/` would put the whole filesystem behind the doc routes. */
	| { kind: "refused"; message: string }
	| { kind: "nested"; message: string };

/**
 * Decides which directories a server may mount, and what to call them.
 *
 * This is the one place that answers "is this a servable root?". `serve`
 * admits the directories a user named on the command line; the stdio bridge
 * instead reconciles roots it discovers from independently-started servers.
 * Both are root policy, so both live here rather than in the CLI — the
 * messages are plain sentences, and the adapter decides how to print them.
 */
export class RootsService {
	constructor(private readonly cwd: string) {}

	/**
	 * Resolve `inputs` against the cwd and decide whether they can be served
	 * together. An empty list means the current directory.
	 *
	 * The returned roots are realpaths, deduped: a symlinked alias of an
	 * already-named directory is dropped rather than served twice, and Vite's
	 * `fs.allow` compares real paths anyway. Nested roots are refused outright
	 * (rather than pruned like `reconcile` does) because a single `serve`
	 * naming both is a mistake worth telling the user about: it would make
	 * `resolveRoot`'s first match order-dependent and list the shared docs
	 * twice.
	 */
	async admit(inputs: string[]): Promise<AdmitRootsResult> {
		const named = inputs.length > 0 ? inputs : ["."];
		const resolved = named.map((input) => path.resolve(this.cwd, input));

		const roots: string[] = [];
		const seen = new Set<string>();
		for (const dirAbs of resolved) {
			let stat;
			try {
				stat = await fsp.stat(dirAbs);
			} catch {
				return { kind: "not-found", message: `no such directory: ${dirAbs}` };
			}
			if (!stat.isDirectory()) {
				return { kind: "not-a-directory", message: `not a directory: ${dirAbs}` };
			}

			const real = await fsp.realpath(dirAbs);
			if (seen.has(real)) continue;
			seen.add(real);
			roots.push(real);
		}

		if (roots.includes("/")) {
			return { kind: "refused", message: "refusing to serve /" };
		}

		for (const outer of roots) {
			for (const inner of roots) {
				if (outer === inner) continue;
				if (isInside(outer, inner)) {
					return {
						kind: "nested",
						message: `${inner} is inside ${outer}; serve only the outer one`,
					};
				}
			}
		}

		return { kind: "ok", roots, rootInfos: computeRootInfos(roots) };
	}

	/**
	 * The roots to present for a union of already-running servers. Unlike
	 * `admit`, nesting here is not a user error — the stdio bridge unions roots
	 * from servers started independently of each other — so an inner root is
	 * silently dropped in favor of its outer one instead of being refused.
	 */
	reconcile(roots: string[]): RootInfo[] {
		return computeRootInfos(pruneNestedRoots(roots));
	}
}
