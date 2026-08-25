import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Registry } from "../components/registry.js";
import type { RootInfo } from "../roots/root-info.js";
import type { RootsService } from "../roots/service.js";
import type { DocCache } from "../docs/doc-cache.js";
import type { SearchService } from "../search/service.js";
import type { RenderPort } from "../rendering/protocol.js";
import type { Remote } from "../servers/remote.js";
import { registerValidateDoc } from "./tools/validate-doc.js";
import { registerListComponents } from "./tools/list-components.js";
import { registerShowComponent } from "./tools/show-component.js";
import { registerSearchDocs } from "./tools/search-docs.js";
import { registerListDocs } from "./tools/list-docs.js";
import { registerListRoots } from "./tools/list-roots.js";
import { registerAddRoot } from "./tools/add-root.js";
import { registerRemoveRoot } from "./tools/remove-root.js";

export interface McpContext {
	/** Every currently-mounted root, in mount order. Called fresh per tool call. */
	getRoots: () => RootInfo[];
	/**
	 * Stdio bridge only: whether a `mdxserve serve` is registered right now.
	 * Called fresh per tool call. Omitted on the HTTP mount, where the server
	 * answering the request is by definition running (treated as `true`).
	 */
	serverRunning?: () => boolean;
	registry: Registry;
	/** Renders a doc server-side (HTTP mode only, where a Vite dev server is live). */
	render?: RenderPort;
	/**
	 * Whether the render step may run for this caller — HTTP loopback only;
	 * stdio leaves it unset (false).
	 */
	allowRender?: boolean;
	/**
	 * Stdio mode only (`mdxserve mcp`): a tRPC-backed proxy to whichever
	 * `mdxserve serve` instance(s) are live. Left undefined in HTTP mode
	 * (the in-process `/__mdxserve/mcp` route), which already has direct
	 * access to the registry and render worker it needs.
	 */
	remote?: Remote;
	/** Per-process state, created once in startServer (or the `mcp` CLI command). */
	docCache: DocCache;
	/** Per-process state, created once in startServer (or the `mcp` CLI command). */
	search: SearchService;
	/**
	 * HTTP mount only: whether root mutations may run for this caller
	 * (loopback). Left unset (false) in stdio mode.
	 */
	allowMutation?: boolean;
	/** HTTP mount only: the live per-process roots service. */
	roots?: RootsService;
}

const SERVER_VERSION = "0.1.0";

export function createMcpServer(ctx: McpContext): McpServer {
	const server = new McpServer({ name: "mdxserve", version: SERVER_VERSION });

	registerValidateDoc(server, ctx);
	registerListComponents(server, ctx);
	registerShowComponent(server, ctx);
	registerSearchDocs(server, ctx);
	registerListDocs(server, ctx);
	registerListRoots(server, ctx);
	registerAddRoot(server, ctx);
	registerRemoveRoot(server, ctx);

	return server;
}
