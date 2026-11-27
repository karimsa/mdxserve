import { useQuery } from "@tanstack/react-query";
import { connect, type Connection } from "./connection";
import { useServers } from "./ServersProvider";
import type { KnownServer } from "./store";

/**
 * The query key of a server's connection checks, beside its `[serverId, procedure, input]`
 * data. It matches the check of every address list the server has had.
 */
export function connectionKey(serverId: string) {
	return [serverId, "connection"] as const;
}

/**
 * The key of one check: the server and the addresses it tried, so adding an address to a
 * server, or an address leaving it, checks again.
 */
function connectionCheckKey(server: KnownServer) {
	return [
		...connectionKey(server.id),
		server.addresses.map((address) => address.url).sort(),
	] as const;
}

/**
 * Which address reaches `server` now. Checked when first used, again whenever the app returns
 * to the foreground, and when a request to the server fails without an answer
 * (`recheckOnNetworkError`). A reachable address is recorded as the server's most recent.
 */
export function useConnection(server: KnownServer) {
	const { probe, recordReached } = useServers();
	return useQuery<Connection>({
		queryKey: connectionCheckKey(server),
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
