import { createRealtime, type RealtimeClient } from "@mdxserve/client/realtime";
import type { QueryClient } from "@tanstack/react-query";

interface LiveServer {
	origin: string;
	client: RealtimeClient;
	unsubscribe(): void;
}

/** One live update socket per server, for the life of the app, at the address that reached it. */
const live = new Map<string, LiveServer>();

/**
 * The live update socket of the server `serverId`, reached at `origin`. It opens the first time
 * the server is used, and again when the server is reached at another address (the old socket
 * closes, and the server's documents, their comments and listings refetch). Its listing and roots signals refresh that server's folder listings and roots; the
 * document screen listens for its own document's signal.
 */
export function realtimeFor(
	serverId: string,
	origin: string,
	queryClient: QueryClient,
): RealtimeClient {
	const current = live.get(serverId);
	if (current?.origin === origin) return current.client;
	if (current) {
		current.unsubscribe();
		current.client.close();
		// The new socket starts with no record of what the old one missed while the address was
		// failing, so whatever this server's documents and listings show may be stale.
		void queryClient.invalidateQueries({ queryKey: [serverId, "getDocument"] });
		void queryClient.invalidateQueries({ queryKey: [serverId, "getDocComments"] });
		void queryClient.invalidateQueries({ queryKey: [serverId, "getFolderListing"] });
		void queryClient.invalidateQueries({ queryKey: [serverId, "listRoots"] });
	}
	const client = createRealtime(origin);
	const offListing = client.onListingChanged(() => {
		void queryClient.invalidateQueries({ queryKey: [serverId, "getFolderListing"] });
	});
	// A folder that left the server takes its documents with it: read them again, so a reader
	// showing one says it is gone.
	const offRoots = client.onRootsChanged(() => {
		void queryClient.invalidateQueries({ queryKey: [serverId, "listRoots"] });
		void queryClient.invalidateQueries({ queryKey: [serverId, "getDocument"] });
		void queryClient.invalidateQueries({ queryKey: [serverId, "getDocComments"] });
	});
	live.set(serverId, {
		origin,
		client,
		unsubscribe() {
			offListing();
			offRoots();
		},
	});
	return client;
}
