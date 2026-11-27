import { queryOptions, useQuery } from "@tanstack/react-query";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import { connect, type Probe } from "./connection";
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
export function connectionOptions(
	server: KnownServer,
	probe: Probe,
	onReached: (info: ServerInfo, origin: string) => void,
) {
	return queryOptions({
		queryKey: connectionCheckKey(server),
		queryFn: async () => {
			const connection = await connect(server, probe);
			if (connection.kind === "reachable") onReached(connection.info, connection.origin);
			return connection;
		},
		// A reachable answer holds for 30 s. Any other is stale at once, so the next request to the
		// server (a pull to refresh, a screen opening) checks the addresses again.
		staleTime: (query) => (query.state.data?.kind === "reachable" ? 30_000 : 0),
		refetchOnWindowFocus: "always",
		retry: false,
	});
}

export function useConnection(server: KnownServer) {
	const { probe, recordReached } = useServers();
	return useQuery(connectionOptions(server, probe, recordReached));
}
