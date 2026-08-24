import { createTRPCClient, httpLink, isTRPCClientError } from "@trpc/client";
import type { AppRouter } from "./api/router.js";
import type { DocTreeRoot, RemoteDocs, RemoteOutcome } from "./mcp.js";
import { liveServers, type ServerRecord } from "./server-registry.js";
import { resolveRoot } from "./paths.js";
import { pruneNestedRoots } from "./roots.js";
import type { ValidationResult } from "./validate.js";
import type { SearchResult } from "./search.js";

const MAX_SEARCH_RESULTS = 30;

/**
 * The base URL a live server is reachable at from this machine. A wildcard
 * bind address (`0.0.0.0`/`::`) only means "accept connections on any local
 * interface", not "answer to that literal address", so it's normalized to
 * loopback. An IPv6 host is bracketed the way a URL requires.
 */
export function serverBaseUrl(record: Pick<ServerRecord, "host" | "port">): string {
	const host = record.host === "0.0.0.0" || record.host === "::" ? "127.0.0.1" : record.host;
	const hostPart = host.includes(":") ? `[${host}]` : host;
	return `http://${hostPart}:${record.port}`;
}

type Client = ReturnType<typeof createTRPCClient<AppRouter>>;

function serverKey(record: Pick<ServerRecord, "host" | "port">): string {
	return `${record.host}:${record.port}`;
}

/**
 * Maps a failed remote call to an outcome: a server-side `TRPCError` (e.g.
 * `NOT_FOUND`, from a `data.code` on the thrown `TRPCClientError`) becomes a
 * reportable `error`; anything else — connection refused, timeout, a
 * response that fails to parse — becomes `unavailable`, so the caller falls
 * back to the local static-only behavior instead of surfacing a confusing
 * network error.
 */
function toOutcome<T>(error: unknown): RemoteOutcome<T> {
	if (isTRPCClientError(error) && error.data?.code !== undefined) {
		return { kind: "error", message: error.message };
	}
	return { kind: "unavailable" };
}

type FanOut<T> =
	{ kind: "answers"; values: T[] } | { kind: "error"; message: string } | { kind: "unavailable" };

/**
 * Sort a fan-out's settled calls into the answers that came back. An
 * unreachable server (connection refused — typically a registry row that
 * outlived its process) is skipped; the servers that did answer are still a
 * complete picture of what is actually running. A live server that answered
 * with a tRPC error is different: it is running, it owns roots, and its data
 * is missing — so that error is surfaced instead of silently returning a
 * partial result as if it were whole. No answers at all → `unavailable`.
 */
function collectFanOut<T>(settled: PromiseSettledResult<T>[]): FanOut<T> {
	const values: T[] = [];
	for (const outcome of settled) {
		if (outcome.status === "fulfilled") {
			values.push(outcome.value);
			continue;
		}
		const failure = toOutcome<T>(outcome.reason);
		if (failure.kind === "error") return failure;
	}
	if (values.length === 0) return { kind: "unavailable" };
	return { kind: "answers", values };
}

/**
 * A tRPC client (over `fetch`) of the running `mdxserve serve` instance(s),
 * used by the stdio MCP bridge to back `validate_doc`, `search_docs`, and
 * `list_docs` with the server's warm search index and render worker instead
 * of re-walking the filesystem locally. `listServers` is injectable for
 * tests; it defaults to the real server registry (`~/.mdxserve/servers.db`).
 */
export function createRemote(listServers: () => ServerRecord[] = liveServers): RemoteDocs {
	const clients = new Map<string, Client>();

	function clientFor(record: ServerRecord): Client {
		const key = serverKey(record);
		let client = clients.get(key);
		if (!client) {
			client = createTRPCClient<AppRouter>({
				links: [httpLink({ url: `${serverBaseUrl(record)}/__mdxserve/trpc` })],
			});
			clients.set(key, client);
		}
		return client;
	}

	return {
		async validateDoc(absPath: string): Promise<ValidationResult | null> {
			const owner = listServers().find(
				(serverRecord) => resolveRoot(serverRecord.roots, absPath) !== null,
			);
			if (!owner) return null;
			try {
				return await clientFor(owner).validateDoc.mutate({ path: absPath });
			} catch {
				return null;
			}
		},

		async listDocs(
			dirPath: string | undefined,
			maxDepth: number,
		): Promise<RemoteOutcome<DocTreeRoot[]>> {
			const servers = listServers();
			if (servers.length === 0) return { kind: "unavailable" };

			if (dirPath !== undefined) {
				const owner = servers.find(
					(serverRecord) => resolveRoot(serverRecord.roots, dirPath) !== null,
				);
				if (!owner) return { kind: "unavailable" };
				try {
					const data = await clientFor(owner).getDocTree.query({ path: dirPath, maxDepth });
					return { kind: "ok", value: data.roots };
				} catch (error) {
					return toOutcome(error);
				}
			}

			// No path: fan out to every server that owns at least one outer root
			// (pruneNestedRoots reconciles roots shared or nested across
			// independently-started servers, e.g. one server serving a subdir of
			// another's root) and stitch their answers back together, keeping
			// exactly the pruned set.
			const wanted = pruneNestedRoots(servers.flatMap((serverRecord) => serverRecord.roots));
			const owningServers = new Map<string, ServerRecord>();
			for (const root of wanted) {
				const owner = servers.find((serverRecord) => serverRecord.roots.includes(root));
				if (owner) owningServers.set(serverKey(owner), owner);
			}
			const distinctOwners = [...owningServers.values()];
			if (distinctOwners.length === 0) return { kind: "ok", value: [] };

			const settled = await Promise.allSettled(
				distinctOwners.map((serverRecord) =>
					clientFor(serverRecord).getDocTree.query({ maxDepth }),
				),
			);
			const collected = collectFanOut(settled);
			if (collected.kind !== "answers") return collected;

			const byDir = new Map<string, DocTreeRoot>();
			for (const answer of collected.values) {
				for (const root of answer.roots) {
					if (!wanted.includes(root.dir) || byDir.has(root.dir)) continue;
					byDir.set(root.dir, root);
				}
			}

			const ordered = wanted
				.map((root) => byDir.get(root))
				.filter((root): root is DocTreeRoot => root !== undefined);
			return { kind: "ok", value: ordered };
		},

		async searchDocs(query: string): Promise<RemoteOutcome<SearchResult[]>> {
			const servers = listServers();
			if (servers.length === 0) return { kind: "unavailable" };

			const settled = await Promise.allSettled(
				servers.map((serverRecord) => clientFor(serverRecord).searchDocs.query({ query })),
			);
			const collected = collectFanOut(settled);
			if (collected.kind !== "answers") return collected;

			// Each server ranks against its own independent MiniSearch index, so
			// merging by raw score is a heuristic, not a true joint ranking —
			// good enough to surface likely hits from every server without
			// letting whichever one happened to answer first dominate. The
			// common case (one live server) is an exact pass-through of that
			// server's own ranking, unaffected by this merge.
			const byPath = new Map<string, SearchResult>();
			for (const answer of collected.values) {
				for (const hit of answer.results) {
					const existing = byPath.get(hit.path);
					if (!existing || hit.score > existing.score) byPath.set(hit.path, hit);
				}
			}
			const merged = [...byPath.values()].sort((first, second) => second.score - first.score);
			return { kind: "ok", value: merged.slice(0, MAX_SEARCH_RESULTS) };
		},
	};
}
