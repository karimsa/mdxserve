import http from "node:http";
import type { AddressInfo } from "node:net";
import type { ViteDevServer } from "vite";
import { handleRequest, type RequestContext } from "../../src/http/server.js";
import type { Registry } from "../../src/components/registry.js";
import { DocCache } from "../../src/docs/doc-cache.js";
import { SearchService } from "../../src/search/service.js";
import { DocsService } from "../../src/docs/service.js";

/**
 * Build a `RequestContext` for `handleRequest` in tests, extracted from the
 * old `POST /__mdxserve/api/validate` test block. The fake `vite` has a
 * `middlewares` stub so the generic `/__mdxserve/*` -> `/@fs/` rewrite (which
 * every unmatched `/__mdxserve/*` path falls through to) doesn't throw when
 * called on `{}`.
 */
export function makeRequestContext(
	fixtureDir: string,
	registry: Registry,
	overrides: Partial<RequestContext> = {},
): RequestContext {
	const docCache = new DocCache();
	const search = new SearchService(docCache);
	const rootInfos = [{ name: "docs", dir: fixtureDir }];
	return {
		rootInfos,
		registry,
		pkgRoot: "",
		vite: {
			middlewares: (_req: unknown, res: http.ServerResponse, next: () => void) => next(),
		} as unknown as ViteDevServer,
		cssFile: "",
		docCache,
		search,
		docs: new DocsService(rootInfos, registry),
		...overrides,
	};
}

/** Start a real http.Server serving `handleRequest` for `ctx`, on an ephemeral port. */
export async function startTestServer(
	ctx: RequestContext,
): Promise<{ server: http.Server; base: string }> {
	const server = http.createServer((req, res) => {
		handleRequest(req, res, ctx).catch((error) => {
			if (!res.headersSent) res.statusCode = 500;
			res.end(String(error));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as AddressInfo).port;
	return { server, base: `http://127.0.0.1:${port}` };
}
