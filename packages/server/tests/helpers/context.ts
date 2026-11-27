import os from "node:os";
import type { ApiContext } from "../../src/api/trpc.js";
import type { Registry } from "../../src/components/registry.js";
import { DocCache } from "../../src/docs/doc-cache.js";
import { SearchService } from "../../src/search/service.js";
import { DocsService } from "../../src/docs/service.js";
import { RootsService } from "../../src/roots/service.js";

/**
 * Build an `ApiContext` for tests, with a fresh `DocCache`, `SearchService`,
 * `RootsService`, and `DocsService` per call so tests never share
 * search-index, parse-cache, mounted-root, or save-lock state. Passing a
 * `roots` override replaces the `RootsService`; `rootInfos` is then derived
 * from it (`roots.list()`) unless `rootInfos` is also overridden.
 */
export function makeContext(
	fixtureDir: string,
	registry: Registry,
	overrides: Partial<ApiContext> = {},
): ApiContext {
	const docCache = new DocCache();
	const roots = overrides.roots ?? new RootsService(fixtureDir, os.homedir(), [fixtureDir]);
	const rootInfos = overrides.rootInfos ?? roots.list();
	return {
		rootInfos,
		roots,
		registry,
		isLoopback: false,
		docCache,
		search: new SearchService(docCache),
		docs: new DocsService(roots, registry),
		...overrides,
	};
}
