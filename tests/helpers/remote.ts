import type { RootInfo } from "../../src/roots/root-info.js";
import type { LiveServer } from "../../src/servers/mounted-roots.js";
import type { Remote } from "../../src/servers/remote.js";

/** Every `Remote` method reporting `unavailable`, for tests that only care about one of them. */
export function unavailableRemote(): Remote {
	return {
		validateDoc: async () => ({ kind: "unavailable" }),
		searchDocs: async () => ({ kind: "unavailable" }),
		listDocs: async () => ({ kind: "unavailable" }),
		listRoots: async () => ({ kind: "unavailable" }),
		addRoots: async () => ({ kind: "unavailable" }),
		removeRoots: async () => ({ kind: "unavailable" }),
	};
}

/** A `LiveServer` with a canned registry row and a `Remote` (every method unavailable unless overridden). */
export function fakeLiveServer(
	options: { running?: boolean; snapshot?: RootInfo[]; remote?: Partial<Remote> } = {},
): LiveServer {
	const snapshot = options.snapshot ?? [];
	return {
		serverRunning: () => options.running ?? true,
		snapshotRoots: () => snapshot,
		remote: { ...unavailableRemote(), ...options.remote },
	};
}
