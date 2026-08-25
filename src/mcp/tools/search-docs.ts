import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchDocsResultSchema } from "../../search/controller.js";
import type { McpContext } from "../server.js";
import { errorResult, textResult, formatSearchResults, NO_SERVER_MESSAGE } from "../format.js";

const searchDocsInput = { query: z.string() };

// Kept in lockstep with the `searchDocs` tRPC procedure's output.
const searchDocsOutput = searchDocsResultSchema.shape;

export function registerSearchDocs(server: McpServer, ctx: McpContext): void {
	const { getRoots, remote, search } = ctx;

	server.registerTool(
		"search_docs",
		{
			title: "Search docs",
			description:
				"Full-text search titles, headings, and bodies of the .md/.mdx docs under the served root. Call this to find where a topic is documented before adding new content, or to check whether something is already covered.",
			inputSchema: searchDocsInput,
			outputSchema: searchDocsOutput,
		},
		async ({ query }) => {
			const roots = getRoots();
			if (roots.length === 0) return errorResult(NO_SERVER_MESSAGE);

			if (remote) {
				const outcome = await remote.searchDocs(query);
				if (outcome.kind === "error") return errorResult(outcome.message);
				if (outcome.kind === "ok") {
					return textResult(formatSearchResults(query, outcome.value), { results: outcome.value });
				}
				// unavailable: fall through to the local index below.
			}

			const { results } = search.search(roots, query);
			return textResult(formatSearchResults(query, results), { results });
		},
	);
}
