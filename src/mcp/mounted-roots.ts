import type { RootInfo } from "../roots/root-info.js";
import type { McpContext } from "./server.js";
import { NO_SERVER_MESSAGE } from "./format.js";

export type MountedRootsResult =
	| { kind: "ok"; roots: RootInfo[] }
	| { kind: "no-server"; message: string }
	| { kind: "error"; message: string };

/**
 * The roots a tool should work against. The registry only answers "is a
 * server running"; what that server has mounted is the server's own answer,
 * so on the stdio bridge this asks it (`remote.listRoots`) rather than
 * trusting the registry row's `roots` snapshot — which can lag a mutation or
 * come back empty from a malformed column while the server is serving fine.
 * `getRoots` is the fallback when the server can't be reached (or in HTTP
 * mode, where it already reads the live set).
 */
export async function mountedRoots(
	ctx: Pick<McpContext, "getRoots" | "serverRunning" | "remote">,
): Promise<MountedRootsResult> {
	if (!(ctx.serverRunning?.() ?? true)) return { kind: "no-server", message: NO_SERVER_MESSAGE };
	if (ctx.remote) {
		const outcome = await ctx.remote.listRoots();
		if (outcome.kind === "ok") return { kind: "ok", roots: outcome.value.roots };
		if (outcome.kind === "error") return { kind: "error", message: outcome.message };
		// unavailable: the row outlived its server, or the request failed —
		// the local snapshot is the best information left.
	}
	return { kind: "ok", roots: ctx.getRoots() };
}
