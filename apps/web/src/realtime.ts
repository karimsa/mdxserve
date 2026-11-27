import { createRealtime, type RealtimeClient } from "@mdxserve/client/realtime";

/**
 * One connection per tab, kept on `window` like the query client in api.ts
 * so a Vite HMR re-execution of this module does not open a second socket.
 */
interface RealtimeWindow extends Window {
	__mdxserveRealtime?: RealtimeClient;
}

function browserClient(): RealtimeClient {
	const realtimeWindow = window as RealtimeWindow;
	return (realtimeWindow.__mdxserveRealtime ??= createRealtime(""));
}

/** A client that never connects, for code that runs where there is no `window`. */
const offline: RealtimeClient = {
	joinDocument() {},
	leaveDocument() {},
	onDocChanged: () => () => {},
	onListingChanged: () => () => {},
	onRootsChanged: () => () => {},
};

export const realtime: RealtimeClient = typeof window === "undefined" ? offline : browserClient();
