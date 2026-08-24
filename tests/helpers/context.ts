import type { ApiContext } from "../../src/api/trpc.js";
import type { Registry } from "../../src/components/registry.js";
import { DocCache } from "../../src/docs/doc-cache.js";
import { SearchService } from "../../src/search/service.js";
import { DocsService } from "../../src/docs/service.js";

/**
 * Build an `ApiContext` for tests, with a fresh `DocCache`, `SearchService`,
 * and `DocsService` per call so tests never share search-index, parse-cache,
 * or save-lock state.
 */
export function makeContext(
	fixtureDir: string,
	registry: Registry,
	overrides: Partial<ApiContext> = {},
): ApiContext {
	const docCache = new DocCache();
	const rootInfos = [{ name: "docs", dir: fixtureDir }];
	return {
		rootInfos,
		registry,
		isLoopback: false,
		docCache,
		search: new SearchService(docCache),
		docs: new DocsService(rootInfos, registry),
		...overrides,
	};
}
