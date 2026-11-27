import { displayName, type KnownServer } from "../servers/store";

/** One hit of `searchDocs`, as far as the app uses it. */
export interface SearchHit {
	path: string;
	label: string;
	title: string;
	excerpt: string;
	terms: string[];
	targetId: string | null;
}

/** What one server's search holds now. */
export type SearchState =
	{ kind: "loading" } | { kind: "ok"; results: SearchHit[] } | { kind: "failed"; message: string };

export type SearchRow =
	| { kind: "result"; key: string; server: KnownServer; hit: SearchHit }
	| { kind: "loading"; key: string }
	| { kind: "empty"; key: string }
	| { kind: "unreachable"; key: string; message: string };

export interface SearchSection {
	key: string;
	title: string;
	server: KnownServer;
	data: SearchRow[];
}

/**
 * One section per server, in the server list's order, each headed by the server's name (S2).
 * A server's results keep its own ranking; there is no ranking across servers. A server that
 * could not be searched says so in its section (S3), one still searching says that, and one
 * with no match says that too, so every server is accounted for.
 */
export function searchSections(
	servers: readonly KnownServer[],
	states: readonly SearchState[],
): SearchSection[] {
	return servers.map((server, index) => {
		const state = states[index] ?? { kind: "loading" };
		const key = server.id;
		let data: SearchRow[];
		if (state.kind === "loading") data = [{ kind: "loading", key: `${key}:loading` }];
		else if (state.kind === "failed") {
			data = [{ kind: "unreachable", key: `${key}:unreachable`, message: state.message }];
		} else if (state.results.length === 0) data = [{ kind: "empty", key: `${key}:empty` }];
		else {
			data = state.results.map((hit) => ({
				kind: "result",
				key: `${key}:${hit.path}#${hit.targetId ?? ""}`,
				server,
				hit,
			}));
		}
		return { key, title: displayName(server), server, data };
	});
}
