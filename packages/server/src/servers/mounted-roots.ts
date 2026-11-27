import { computeRootInfos, type RootInfo } from "../roots/root-info.js";
import { RemoteClient, type Remote } from "./remote.js";
import type { ServerRegistry } from "./server-registry.js";

/** What a CLI verb needs to know about the one running `mdxserve serve`, read fresh per call. */
export interface LiveServer {
	serverRunning: () => boolean;
	snapshotRoots: () => RootInfo[];
	remote: Remote;
}

export function liveServerFrom(serverRegistry: ServerRegistry): LiveServer {
	return {
		serverRunning: () => serverRegistry.current() !== undefined,
		snapshotRoots: () => computeRootInfos(serverRegistry.current()?.roots ?? []),
		remote: new RemoteClient(() => serverRegistry.current()),
	};
}

export type MountedRootsResult =
	{ kind: "ok"; roots: RootInfo[] } | { kind: "no-server" } | { kind: "error"; message: string };

/**
 * The roots a command should work against. The registry only answers "is a
 * server running"; what that server has mounted is the server's own answer,
 * so this asks it (`remote.listRoots`) rather than trusting the registry
 * row's `roots` snapshot, which can lag a mutation. The snapshot is the
 * fallback when the server cannot be reached.
 */
export async function mountedRoots(server: LiveServer): Promise<MountedRootsResult> {
	if (!server.serverRunning()) return { kind: "no-server" };
	const outcome = await server.remote.listRoots();
	if (outcome.kind === "ok") return { kind: "ok", roots: outcome.value.roots };
	if (outcome.kind === "error") return { kind: "error", message: outcome.message };
	// unavailable: the row outlived its server, or the request failed; the
	// local snapshot is the best information left.
	return { kind: "ok", roots: server.snapshotRoots() };
}
