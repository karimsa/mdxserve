import type { RootInfo } from "../../src/roots/root-info.js";
import type { LiveServer } from "../../src/servers/mounted-roots.js";
import type { Remote } from "../../src/servers/remote.js";
import type { ServerRecord } from "../../src/servers/server-registry.js";

/** Every `Remote` method reporting `unavailable`, for tests that only care about one of them. */
function unavailableRemote(): Remote {
	return {
		validateDoc: async () => ({ kind: "unavailable" }),
		searchDocs: async () => ({ kind: "unavailable" }),
		listDocs: async () => ({ kind: "unavailable" }),
		listRoots: async () => ({ kind: "unavailable" }),
		addRoots: async () => ({ kind: "unavailable" }),
		removeRoots: async () => ({ kind: "unavailable" }),
		getServerInfo: async () => ({ kind: "unavailable" }),
	};
}

/** A `LiveServer` with a canned registry row and a `Remote` (every method unavailable unless overridden). */
export function fakeLiveServer(
	options: {
		running?: boolean;
		snapshot?: RootInfo[];
		remote?: Partial<Remote>;
		record?: Partial<ServerRecord>;
	} = {},
): LiveServer {
	const snapshot = options.snapshot ?? [];
	const running = options.running ?? true;
	const record: ServerRecord = {
		pid: 4242,
		host: "127.0.0.1",
		port: 4040,
		roots: snapshot.map((root) => root.dir),
		startedAt: 0,
		...options.record,
	};
	return {
		serverRunning: () => running,
		record: () => (running ? record : undefined),
		snapshotRoots: () => snapshot,
		remote: { ...unavailableRemote(), ...options.remote },
	};
}
