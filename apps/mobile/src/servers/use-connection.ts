import { useQuery } from "@tanstack/react-query";
import { connect, type Connection } from "./connection";
import { useServers } from "./ServersProvider";
import type { KnownServer } from "./store";

/** The query key of a server's connection check, beside its `[serverId, procedure, input]` data. */
export function connectionKey(serverId: string) {
	return [serverId, "connection"] as const;
}

/**
 * Which address reaches `server` now. Checked when first used, again whenever the app returns
 * to the foreground, and when a request to the server fails without an answer
 * (`recheckOnNetworkError`). A reachable address is recorded as the server's most recent.
 */
export function useConnection(server: KnownServer) {
	const { probe, recordReached } = useServers();
	return useQuery<Connection>({
		queryKey: connectionKey(server.id),
		queryFn: async () => {
			const connection = await connect(server, probe);
			if (connection.kind === "reachable") recordReached(connection.info, connection.origin);
			return connection;
		},
		staleTime: 30_000,
		refetchOnWindowFocus: "always",
		retry: false,
	});
}
