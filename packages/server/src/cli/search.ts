import { DocCache } from "../docs/doc-cache.js";
import { mountedRoots, type LiveServer } from "../servers/mounted-roots.js";
import { SearchService, type SearchResult } from "../search/service.js";
import { formatSearchResults, NO_ROOTS_MESSAGE, NO_SERVER_MESSAGE } from "./format.js";
import { fail, ok, type CommandOutcome } from "./outcome.js";

export async function runSearch(
	query: string,
	options: { json?: boolean },
	deps: { server: LiveServer },
): Promise<CommandOutcome> {
	const mounted = await mountedRoots(deps.server);
	if (mounted.kind === "no-server") return fail(NO_SERVER_MESSAGE);
	if (mounted.kind === "error") return fail(mounted.message);
	if (mounted.roots.length === 0) return fail(NO_ROOTS_MESSAGE);

	let results: SearchResult[];
	const outcome = await deps.server.remote.searchDocs(query);
	if (outcome.kind === "error") return fail(outcome.message);
	if (outcome.kind === "ok") {
		results = outcome.value;
	} else {
		// unavailable: fall back to a local index over the snapshot roots.
		results = new SearchService(new DocCache()).search(mounted.roots, query).results;
	}

	if (options.json) return ok([JSON.stringify({ results }, null, 2)]);
	return ok([formatSearchResults(query, results)]);
}
