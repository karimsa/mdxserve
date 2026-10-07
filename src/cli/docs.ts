import path from "node:path";
import { DocCache } from "../docs/doc-cache.js";
import type { DocTreeRoot } from "../listing/controller.js";
import { ListingService } from "../listing/service.js";
import { expandHome } from "../roots/paths.js";
import { mountedRoots, type LiveServer } from "../servers/mounted-roots.js";
import { formatDocTree, NO_ROOTS_MESSAGE, NO_SERVER_MESSAGE } from "./format.js";
import { fail, ok, type CommandOutcome } from "./outcome.js";

const MIN_DEPTH = 1;
const MAX_DEPTH = 8;

export async function runDocs(
	dir: string | undefined,
	options: { depth: string; json?: boolean },
	deps: { server: LiveServer; cwd: string; home: string },
): Promise<CommandOutcome> {
	const maxDepth = Number(options.depth);
	if (!Number.isInteger(maxDepth) || maxDepth < MIN_DEPTH || maxDepth > MAX_DEPTH) {
		return fail(`invalid --depth "${options.depth}" (expected an integer from 1 to 8)`);
	}

	const mounted = await mountedRoots(deps.server);
	if (mounted.kind === "no-server") return fail(NO_SERVER_MESSAGE);
	if (mounted.kind === "error") return fail(mounted.message);
	if (mounted.roots.length === 0) return fail(NO_ROOTS_MESSAGE);

	const dirAbs = dir === undefined ? undefined : path.resolve(deps.cwd, expandHome(dir, deps.home));

	let roots: DocTreeRoot[];
	const outcome = await deps.server.remote.listDocs(dirAbs, maxDepth);
	if (outcome.kind === "error") return fail(outcome.message);
	if (outcome.kind === "ok") {
		roots = outcome.value;
	} else {
		// unavailable: walk the snapshot roots locally.
		const result = await new ListingService(mounted.roots, new DocCache()).docTree({
			path: dirAbs,
			maxDepth,
		});
		if (result.kind === "not-found") return fail(result.message);
		roots = result.roots;
	}

	if (options.json) return ok([JSON.stringify({ roots }, null, 2)]);
	return ok([formatDocTree(roots, dirAbs ?? null)]);
}
