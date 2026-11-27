import { createTRPCClient, httpLink, type TRPCClient } from "@trpc/client";
// This package may only import types from the server (AGENTS.md): this import is erased by
// the compiler, so no server code reaches a client bundle.
import type { AppRouter } from "@karimsa/mdxserve/src/api/router";

/**
 * The tRPC client for the server at `baseUrl`: an origin such as `https://box.ts.net:4040`, or
 * `""` for the origin the page itself came from.
 */
export function createApiClient(baseUrl: string): TRPCClient<AppRouter> {
	return createTRPCClient<AppRouter>({
		// httpLink, not a batch link: GET for queries, POST for mutations, one
		// request per call — keeps Network tab entries legible and matches the
		// one-route-per-call shape the old fetch() call sites had. It is not a streaming
		// link either: React Native lacks the APIs those need.
		links: [httpLink({ url: `${baseUrl}/__mdxserve/trpc` })],
	});
}
