import { useMemo } from "react";
import { z } from "zod";
import type { KnownServer } from "../servers/store";
import type { KeyValueStorage } from "../servers/storage";
import { useStoredChoice, type StoredChoice } from "../preferences/stored-choice";

/** Where the servers left out of search are kept: their ids, as JSON. */
const SEARCH_EXCLUDED_KEY = "mdxserve.search.excludedServers";

const excludedSchema = z.array(z.string());

function parseExcluded(stored: string): string[] | undefined {
	try {
		const parsed = excludedSchema.safeParse(JSON.parse(stored));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
}

const formatExcluded = (ids: string[]) => JSON.stringify(ids);

/**
 * The servers a search leaves out. Every server is searched unless the reader turned it off,
 * so a server added later is searched. Only ids of servers still in the list count, and only
 * they are written back, so a removed server's id is dropped on the next change.
 */
export function useSearchServerFilter(storage: KeyValueStorage, servers: readonly KnownServer[]) {
	const choice: StoredChoice<string[]> = useStoredChoice({
		storage,
		key: SEARCH_EXCLUDED_KEY,
		fallback: [],
		parse: parseExcluded,
		format: formatExcluded,
		describe: "the server filter",
	});
	const { value, set, saving, problem } = choice;
	return useMemo(() => {
		const known = new Set(servers.map((server) => server.id));
		const excluded = new Set(value.filter((id) => known.has(id)));
		return {
			/** The servers to search, in the server list's order. */
			included: servers.filter((server) => !excluded.has(server.id)),
			isIncluded: (id: string) => !excluded.has(id),
			/** True when at least one server is left out. */
			active: excluded.size > 0,
			toggle(id: string) {
				const next = new Set(excluded);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				set(servers.map((server) => server.id).filter((serverId) => next.has(serverId)));
			},
			saving,
			problem,
		};
	}, [servers, value, set, saving, problem]);
}
