import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveDirPath } from "../../roots/paths.js";
import { ListingService } from "../../listing/service.js";
import { docTreeSchema } from "../../listing/controller.js";
import type { McpContext } from "../server.js";
import { mountedRoots } from "../mounted-roots.js";
import { errorResult, textResult, formatDocTree, NO_ROOTS_MESSAGE } from "../format.js";

const listDocsInput = {
	path: z.string().optional(),
	maxDepth: z.number().int().min(1).max(8).default(8),
};

// Kept in lockstep with the `getDocTree` tRPC procedure's output — importing
// its zod shape (rather than a hand-copied one) means the two can't drift.
const listDocsOutput = docTreeSchema.shape;

export function registerListDocs(server: McpServer, ctx: McpContext): void {
	const { remote, docCache } = ctx;

	server.registerTool(
		"list_docs",
		{
			title: "List docs",
			description:
				"List the tree of .md/.mdx docs (and directories that contain them) under every served root, or under one absolute directory path, up to maxDepth levels deep. Paths are absolute, the same form the site uses in its URLs. Call this to see what docs already exist and which roots are served, e.g. before deciding where a new doc belongs — or call list_roots directly to just see the mounted folders.",
			inputSchema: listDocsInput,
			outputSchema: listDocsOutput,
		},
		async ({ path: dirPath, maxDepth }) => {
			const mounted = await mountedRoots(ctx);
			if (mounted.kind !== "ok") return errorResult(mounted.message);
			const roots = mounted.roots;
			if (roots.length === 0) return errorResult(NO_ROOTS_MESSAGE);
			const rootDirs = roots.map((rootInfo) => rootInfo.dir);

			if (remote) {
				const outcome = await remote.listDocs(dirPath, maxDepth);
				if (outcome.kind === "error") return errorResult(outcome.message);
				if (outcome.kind === "ok") {
					let dirAbs: string | null = null;
					if (dirPath !== undefined) {
						const hit = await resolveDirPath(rootDirs, dirPath);
						dirAbs = hit.ok ? hit.abs : null;
					}
					return textResult(formatDocTree(outcome.value, dirAbs), { roots: outcome.value });
				}
				// unavailable: fall through to the local walk below.
			}

			const result = await new ListingService(roots, docCache).docTree({ path: dirPath, maxDepth });
			if (result.kind === "not-found") return errorResult(result.message);
			return textResult(formatDocTree(result.roots, result.dirAbs ?? null), {
				roots: result.roots,
			});
		},
	);
}
