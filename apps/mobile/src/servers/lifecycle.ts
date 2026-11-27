import { focusManager, onlineManager, type Query, type QueryClient } from "@tanstack/react-query";
import { addNetworkStateListener } from "expo-network";
import { AppState } from "react-native";
import { connectionKey } from "./use-connection";

/**
 * Tell TanStack Query when the device goes on or off line (expo-network) and when the app comes
 * back to the foreground (`AppState`), so it pauses and refetches the way a browser tab does.
 * Online is `isConnected`, not "internet reachable": a server on the LAN or the tailnet needs no
 * internet. Returns the function that stops both.
 */
export function wireQueryLifecycle(): () => void {
	onlineManager.setEventListener((setOnline) => {
		const subscription = addNetworkStateListener((state) => setOnline(state.isConnected !== false));
		return () => subscription.remove();
	});
	const subscription = AppState.addEventListener("change", (status) =>
		focusManager.setFocused(status === "active"),
	);
	return () => subscription.remove();
}

/** A request that never reached a server: tRPC's error with no answer from it. */
function isNetworkError(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.name === "TRPCClientError" &&
		(error as { data?: unknown }).data == null
	);
}

/**
 * When a query keyed `[serverId, procedure, input]` fails without an answer, check again which
 * of the server's addresses reaches it.
 */
export function recheckOnNetworkError(queryClient: QueryClient) {
	return (error: unknown, query: Query<unknown, unknown, unknown>) => {
		const [serverId, procedure] = query.queryKey;
		if (typeof serverId !== "string" || procedure === "connection" || !isNetworkError(error)) {
			return;
		}
		void queryClient.invalidateQueries({ queryKey: connectionKey(serverId) });
	};
}
