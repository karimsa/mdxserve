import { createApiClient } from "@mdxserve/client/api";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Connection } from "./connection";
import { useServers } from "./ServersProvider";
import type { KnownServer } from "./store";
import { connectionOptions } from "./use-connection";

type ApiClient = ReturnType<typeof createApiClient>;

/** One client per origin, kept for the life of the app. */
const clients = new Map<string, ApiClient>();

function clientFor(origin: string): ApiClient {
	let client = clients.get(origin);
	if (!client) {
		client = createApiClient(origin);
		clients.set(origin, client);
	}
	return client;
}

/** A server none of whose addresses answered with its id, as a query error. */
class UnreachableServerError extends Error {
	constructor(readonly connection: Exclude<Connection, { kind: "reachable" }>) {
		super(
			connection.kind === "changed"
				? `${new URL(connection.origins[0]).host} is now a different server`
				: "Unreachable",
		);
		this.name = "UnreachableServerError";
	}
}

/**
 * Query options for one procedure on one server, keyed `[serverId, procedure, input]`. The
 * request goes to the address the server's connection check found; a server that is not
 * reachable fails the query with `UnreachableServerError`.
 */
export function useServerQueryOptions() {
	const queryClient = useQueryClient();
	const { probe, recordReached } = useServers();
	return useCallback(
		<Input, Result>(
			server: KnownServer,
			procedure: string,
			input: Input,
			call: (client: ApiClient, input: Input) => Promise<Result>,
		) => ({
			queryKey: [server.id, procedure, input] as const,
			queryFn: async (): Promise<Result> => {
				const connection = await queryClient.fetchQuery(
					connectionOptions(server, probe, recordReached),
				);
				if (connection.kind !== "reachable") throw new UnreachableServerError(connection);
				return call(clientFor(connection.origin), input);
			},
			retry: false,
		}),
		[queryClient, probe, recordReached],
	);
}
