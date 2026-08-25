import { createTRPCClient, httpLink, isTRPCClientError } from "@trpc/client";
import type { AppRouter } from "../api/router.js";
import type { DocTreeRoot } from "../listing/controller.js";
import type { AddRootsOutput, ListRootsOutput, RemoveRootsOutput } from "../roots/controller.js";
import type { ServerRecord } from "./server-registry.js";
import type { ValidationResult } from "../validation/validate.js";
import type { SearchResult } from "../search/service.js";

export type RemoteOutcome<Value> =
	{ kind: "ok"; value: Value } | { kind: "error"; message: string } | { kind: "unavailable" };

/**
 * Stdio mode only: proxies `validate_doc`/`search_docs`/`list_docs` and the
 * roots procedures to the single running `mdxserve serve` instance, over a
 * tRPC client (see `getServer` below), so the server's warm search index,
 * render worker, and mounted roots are the single source of truth.
 * `{ kind: "unavailable" }` means no server is running, or the request
 * itself failed to reach it; `validate_doc`'s caller falls back to local,
 * static-only handling in that case.
 */
export interface Remote {
	validateDoc(absPath: string): Promise<RemoteOutcome<ValidationResult>>;
	searchDocs(query: string): Promise<RemoteOutcome<SearchResult[]>>;
	listDocs(dirPath: string | undefined, maxDepth: number): Promise<RemoteOutcome<DocTreeRoot[]>>;
	listRoots(): Promise<RemoteOutcome<ListRootsOutput>>;
	addRoots(dirs: string[]): Promise<RemoteOutcome<AddRootsOutput>>;
	removeRoots(dirs: string[]): Promise<RemoteOutcome<RemoveRootsOutput>>;
}

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

/**
 * Maps a failed remote call to an outcome: a server-side `TRPCError` (e.g.
 * `NOT_FOUND`, from a `data.code` on the thrown `TRPCClientError`) becomes a
 * reportable `error`; anything else — connection refused, timeout, a
 * response that fails to parse — becomes `unavailable`, so the caller falls
 * back to the local static-only behavior instead of surfacing a confusing
 * network error.
 */
export function toOutcome<Value>(error: unknown): RemoteOutcome<Value> {
	if (isTRPCClientError(error) && error.data?.code !== undefined) {
		return { kind: "error", message: error.message };
	}
	return { kind: "unavailable" };
}

/**
 * A tRPC client (over `fetch`) of the single running `mdxserve serve`
 * instance, used by the stdio MCP bridge to back `validate_doc`,
 * `search_docs`, `list_docs`, and the roots tools with the server's live
 * state instead of re-walking the filesystem locally. `getServer` is
 * injected by the caller — `mdxserve mcp` passes `() => serverRegistry.current()`;
 * tests pass a fake. The underlying tRPC client is cached and only rebuilt
 * when `getServer()` reports a different host:port than the one currently
 * cached (e.g. the server restarted on a new port).
 */
export class RemoteClient implements Remote {
	private client: Client | undefined;
	private clientKey: string | undefined;

	constructor(private readonly getServer: () => ServerRecord | undefined) {}

	private clientFor(record: ServerRecord): Client {
		const key = `${record.host}:${record.port}`;
		if (!this.client || this.clientKey !== key) {
			this.client = createTRPCClient<AppRouter>({
				links: [httpLink({ url: `${serverBaseUrl(record)}/__mdxserve/trpc` })],
			});
			this.clientKey = key;
		}
		return this.client;
	}

	async validateDoc(absPath: string): Promise<RemoteOutcome<ValidationResult>> {
		const server = this.getServer();
		if (!server) return { kind: "unavailable" };
		try {
			const value = await this.clientFor(server).validateDoc.mutate({ path: absPath });
			return { kind: "ok", value };
		} catch (error) {
			return toOutcome(error);
		}
	}

	async searchDocs(query: string): Promise<RemoteOutcome<SearchResult[]>> {
		const server = this.getServer();
		if (!server) return { kind: "unavailable" };
		try {
			const data = await this.clientFor(server).searchDocs.query({ query });
			return { kind: "ok", value: data.results };
		} catch (error) {
			return toOutcome(error);
		}
	}

	async listDocs(
		dirPath: string | undefined,
		maxDepth: number,
	): Promise<RemoteOutcome<DocTreeRoot[]>> {
		const server = this.getServer();
		if (!server) return { kind: "unavailable" };
		try {
			const data = await this.clientFor(server).getDocTree.query({ path: dirPath, maxDepth });
			return { kind: "ok", value: data.roots };
		} catch (error) {
			return toOutcome(error);
		}
	}

	async listRoots(): Promise<RemoteOutcome<ListRootsOutput>> {
		const server = this.getServer();
		if (!server) return { kind: "unavailable" };
		try {
			const value = await this.clientFor(server).listRoots.query();
			return { kind: "ok", value };
		} catch (error) {
			return toOutcome(error);
		}
	}

	async addRoots(dirs: string[]): Promise<RemoteOutcome<AddRootsOutput>> {
		const server = this.getServer();
		if (!server) return { kind: "unavailable" };
		try {
			const value = await this.clientFor(server).addRoots.mutate({ dirs });
			return { kind: "ok", value };
		} catch (error) {
			return toOutcome(error);
		}
	}

	async removeRoots(dirs: string[]): Promise<RemoteOutcome<RemoveRootsOutput>> {
		const server = this.getServer();
		if (!server) return { kind: "unavailable" };
		try {
			const value = await this.clientFor(server).removeRoots.mutate({ dirs });
			return { kind: "ok", value };
		} catch (error) {
			return toOutcome(error);
		}
	}
}
