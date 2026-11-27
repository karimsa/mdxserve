import http from "node:http";
import os from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { handleRequest, type ClientBundle, type RequestContext } from "../../src/http/server.js";
import { loadShellTemplate } from "../../src/http/shell.js";
import { getPackageRoot } from "../../src/infra/pkg.js";
import type { Registry } from "../../src/components/registry.js";
import { DocCache } from "../../src/docs/doc-cache.js";
import { SearchService } from "../../src/search/service.js";
import { DocsService } from "../../src/docs/service.js";
import { RootsService } from "../../src/roots/service.js";

/**
 * The source `client/index.html`, which carries the same fill markers as the built one, so
 * shell tests need no `yarn build` (CI runs tests first).
 */
export function shellTemplate(): string {
	return loadShellTemplate(path.join(getPackageRoot(), "client"));
}

/** A client bundle whose `assets/` and favicon live in `dir` (the source client/ by default). */
export function testClientBundle(dir = path.join(getPackageRoot(), "client")): ClientBundle {
	return { dir, template: shellTemplate() };
}

/**
 * Build a `RequestContext` for `handleRequest` in tests. Passing a `roots` override replaces the `RootsService`
 * entirely — `handleRequest` reads `ctx.roots.list()` itself, so there's no
 * separate `rootInfos` to keep in sync.
 */
export function makeRequestContext(
	fixtureDir: string,
	registry: Registry,
	overrides: Partial<RequestContext> = {},
): RequestContext {
	const docCache = new DocCache();
	const search = new SearchService(docCache);
	const roots = overrides.roots ?? new RootsService(fixtureDir, os.homedir(), [fixtureDir]);
	return {
		roots,
		registry,
		client: testClientBundle(),
		docCache,
		search,
		docs: new DocsService(roots, registry),
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
