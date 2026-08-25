import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addRootsResultSchema } from "../../roots/controller.js";
import type { RootInfo } from "../../roots/root-info.js";
import type { McpContext } from "../server.js";
import { errorResult, textResult, formatRoots, NO_SERVER_MESSAGE } from "../format.js";

const addRootInput = { path: z.string().min(1) };

// Kept in lockstep with the `addRoots` tRPC procedure's output.
const addRootOutput = addRootsResultSchema.shape;

function formatAdded(requestedPath: string, added: string[], mountedRoots: RootInfo[]): string {
	const lines =
		added.length > 0 ? added.map((dir) => `Added ${dir}`) : [`${requestedPath} is already mounted`];
	return [...lines, formatRoots(mountedRoots)].join("\n");
}

export function registerAddRoot(server: McpServer, ctx: McpContext): void {
	const { remote, roots, allowMutation } = ctx;

	server.registerTool(
		"add_root",
		{
			title: "Add a served root",
			description:
				"Mount a directory on the running mdxserve server so its .md/.mdx docs are listed, searched, and validated. The path must be absolute. Roots last only until the server stops; after a restart only the folders named on the `mdxserve serve` command line are mounted. Mounting a directory already served, or one nested inside (or containing) an already-served root, is refused. Call list_roots first to see what is already mounted.",
			inputSchema: addRootInput,
			outputSchema: addRootOutput,
		},
		async ({ path: dirPath }) => {
			if (!path.isAbsolute(dirPath)) {
				return errorResult(`add_root requires an absolute path, got: ${dirPath}`);
			}

			if (remote) {
				const outcome = await remote.addRoots([dirPath]);
				if (outcome.kind === "error") return errorResult(outcome.message);
				if (outcome.kind === "ok") {
					return textResult(
						formatAdded(dirPath, outcome.value.added, outcome.value.roots),
						outcome.value,
					);
				}
				// unavailable: no server is running; there is no HTTP-mode roots
				// service to fall back to either, so this reports NO_SERVER_MESSAGE
				// via the shared return below.
			}

			if (roots) {
				if (!allowMutation) {
					return errorResult("add_root is only available to same-machine callers");
				}
				const result = await roots.add([dirPath]);
				switch (result.kind) {
					case "ok":
						// Structured output must match the declared schema (no `kind` tag),
						// the same shape the stdio path gets back from the tRPC procedure.
						return textResult(formatAdded(dirPath, result.added, result.roots), {
							added: result.added,
							roots: result.roots,
						});
					case "not-found":
					case "not-a-directory":
					case "refused":
					case "nested":
						return errorResult(result.message);
					default: {
						const exhaustiveResult: never = result;
						throw new Error(`Unhandled addRoot result: ${JSON.stringify(exhaustiveResult)}`);
					}
				}
			}

			return errorResult(NO_SERVER_MESSAGE);
		},
	);
}
