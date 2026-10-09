import { z } from "zod";
import { procedure } from "../api/trpc.js";

export const searchDocsInput = z.object({ query: z.string() });

// Matches src/search/service.ts's SearchResult, plus `score` from the MiniSearch hit
// so the stdio bridge can merge results across servers.
export const searchResultSchema = z.object({
	path: z.string(),
	/** Display label: `"<rootName>/<relative path>"`. */
	label: z.string(),
	title: z.string(),
	excerpt: z.string(),
	/** Query terms MiniSearch matched for this hit, for client-side highlighting. */
	terms: z.array(z.string()),
	score: z.number(),
});

export const searchDocsResultSchema = z.object({ results: z.array(searchResultSchema) });

const searchDocs = procedure(
	"Full-text search across the titles, headings, and bodies of every served doc, ranked, capped at 30 results. Used by the ⌘K search dialog and `mdxserve search`; an empty query returns docs in tree order.",
)
	.input(searchDocsInput)
	.output(searchDocsResultSchema)
	.query(({ ctx, input }) =>
		ctx.search.search(ctx.rootInfos, input.query, ctx.permissions === "restricted"),
	);

export const searchController = { searchDocs };

export type SearchDocsInput = z.infer<typeof searchDocsInput>;
export type SearchResultOutput = z.infer<typeof searchResultSchema>;
export type SearchDocsResult = z.infer<typeof searchDocsResultSchema>;
