import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listRootsResultSchema } from "../../roots/controller.js";
import type { McpContext } from "../server.js";
import { errorResult, textResult, formatRoots, NO_SERVER_MESSAGE } from "../format.js";

const listRootsInput = {};

// Kept in lockstep with the `listRoots` tRPC procedure's output.
const listRootsOutput = listRootsResultSchema.shape;

export function registerListRoots(server: McpServer, ctx: McpContext): void {
	const { remote, roots, getRoots } = ctx;

	server.registerTool(
		"list_roots",
		{
			title: "List served roots",
			description:
				"List every folder currently mounted on the running mdxserve server, in mount order. Works even when nothing is mounted yet, returning an empty list rather than an error. Call this before add_root to see what is already served, so you don't mount a duplicate or a directory nested inside (or containing) one already served.",
			inputSchema: listRootsInput,
			outputSchema: listRootsOutput,
		},
		async () => {
			if (remote) {
				const outcome = await remote.listRoots();
				if (outcome.kind === "error") return errorResult(outcome.message);
				if (outcome.kind === "ok") {
					return textResult(formatRoots(outcome.value.roots), outcome.value);
				}
				// unavailable: no server is running to ask, stdio-side.
				return errorResult(NO_SERVER_MESSAGE);
			}

			// HTTP mount: the live per-process roots service is the source of
			// truth. Neither set (a bare `getRoots`-only context, e.g. a test
			// harness): report whatever it already knows, same as every other
			// tool falls back to it.
			const rootInfos = roots ? roots.list() : getRoots();
			return textResult(formatRoots(rootInfos), { roots: rootInfos });
		},
	);
}
