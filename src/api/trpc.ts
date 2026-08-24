import { initTRPC, TRPCError } from "@trpc/server";
import type { Registry } from "../components/registry.js";
import type { RootInfo } from "../roots/root-info.js";
import type { RenderOutcome } from "../rendering/protocol.js";
import type { DocCache } from "../docs/doc-cache.js";
import type { SearchService } from "../search/service.js";
import type { DocsService } from "../docs/service.js";

/**
 * Everything a procedure resolver needs, built fresh per request by
 * `createContext` in `src/http/server.ts`. `registry` always comes from here,
 * never a module-scope `loadRegistry()` — CI runs tests before `yarn build`,
 * so `dist/registry.json` may not exist yet.
 */
export interface ApiContext {
	rootInfos: RootInfo[];
	registry: Registry;
	/** Whether this request came from the same machine (see src/http/server.ts). */
	isLoopback: boolean;
	/** Renders a doc server-side; only defined when a Vite dev server is live. */
	render?: (absPath: string) => Promise<RenderOutcome>;
	/** Per-process state, created once in startServer. */
	docCache: DocCache;
	/** Per-process state, created once in startServer. */
	search: SearchService;
	/** Per-process state, created once in startServer: it owns the per-file save lock. */
	docs: DocsService;
	/** The request's `Origin` header, when the caller sent one (browsers do on every POST). */
	origin?: string;
	/** The `Host` header the request arrived on. */
	host?: string;
}

export interface ProcedureMeta {
	/** What this method is used for and by whom — shown in docs and tests. */
	description: string;
}

const t = initTRPC.context<ApiContext>().meta<ProcedureMeta>().create();

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

/**
 * A same-origin request either omits `Origin` (a plain navigation, or a
 * fetch without CORS) or sends one whose host matches the `Host` header it
 * arrived on. Anything else — including an unparsable or `null` origin — is
 * cross-origin.
 */
function isCrossOrigin(ctx: ApiContext): boolean {
	if (ctx.origin === undefined) return false;
	let originHost: string;
	try {
		originHost = new URL(ctx.origin).host;
	} catch {
		return true;
	}
	return originHost !== ctx.host;
}

// Mutations are write surfaces, and the server may be bound to 0.0.0.0 for
// LAN sharing — a cross-origin page must not be able to reach them. The
// JSON-only body requirement already forces a CORS preflight (which this
// server never answers), so this is belt-and-braces for callers that skip
// preflight rules; queries stay reachable since nothing they return can be
// read cross-origin without CORS headers either.
const rejectCrossOriginMutations = t.middleware(({ ctx, type, next }) => {
	if (type === "mutation" && isCrossOrigin(ctx)) {
		throw new TRPCError({ code: "FORBIDDEN", message: "Cross-origin write rejected" });
	}
	return next();
});

// The only way to start a procedure: a description is a required argument.
// `t.procedure` itself is deliberately not exported, so a description-less
// procedure doesn't compile.
export function procedure(description: string) {
	return t.procedure.meta({ description }).use(rejectCrossOriginMutations);
}
