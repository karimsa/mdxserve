import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { removeRootsResultSchema } from "../../roots/controller.js";
import type { RootInfo } from "../../roots/root-info.js";
import type { McpContext } from "../server.js";
import { errorResult, textResult, formatRoots, NO_SERVER_MESSAGE } from "../format.js";

const removeRootInput = { path: z.string().min(1) };

// Kept in lockstep with the `removeRoots` tRPC procedure's output.
const removeRootOutput = removeRootsResultSchema.shape;

function formatRemoved(requestedPath: string, removed: string[], mountedRoots: RootInfo[]): string {
	const lines =
		removed.length > 0
			? removed.map((dir) => `Removed ${dir}`)
			: [`${requestedPath} was not mounted`];
	return [...lines, formatRoots(mountedRoots)].join("\n");
}

export function registerRemoveRoot(server: McpServer, ctx: McpContext): void {
	const { remote, roots, allowMutation } = ctx;

	server.registerTool(
		"remove_root",
		{
			title: "Remove a served root",
			description:
				"Unmount a directory from the running mdxserve server, so its docs are no longer listed, searched, or validated. The path must be absolute and currently mounted (call list_roots to check). Refuses when the directory isn't mounted.",
			inputSchema: removeRootInput,
			outputSchema: removeRootOutput,
		},
		async ({ path: dirPath }) => {
			if (!path.isAbsolute(dirPath)) {
				return errorResult(`remove_root requires an absolute path, got: ${dirPath}`);
			}

			if (remote) {
				const outcome = await remote.removeRoots([dirPath]);
				if (outcome.kind === "error") return errorResult(outcome.message);
				if (outcome.kind === "ok") {
					return textResult(
						formatRemoved(dirPath, outcome.value.removed, outcome.value.roots),
						outcome.value,
					);
				}
				// unavailable: no server is running; there is no HTTP-mode roots
				// service to fall back to either, so this reports NO_SERVER_MESSAGE
				// via the shared return below.
			}

			if (roots) {
				if (!allowMutation) {
					return errorResult("remove_root is only available to same-machine callers");
				}
				const result = await roots.remove([dirPath]);
				switch (result.kind) {
					case "ok":
						// Structured output must match the declared schema (no `kind` tag),
						// the same shape the stdio path gets back from the tRPC procedure.
						return textResult(formatRemoved(dirPath, result.removed, result.roots), {
							removed: result.removed,
							roots: result.roots,
						});
					case "not-mounted":
						return errorResult(result.message);
					default: {
						const exhaustiveResult: never = result;
						throw new Error(`Unhandled removeRoot result: ${JSON.stringify(exhaustiveResult)}`);
					}
				}
			}

			return errorResult(NO_SERVER_MESSAGE);
		},
	);
}
