import type { HotPayload } from "vite";

export type RenderOutcome =
	{ ok: true } | { ok: false; message: string; stack?: string; line?: number; column?: number };

/** A function that server-side renders an already statically-valid `.md`/`.mdx` file. */
export type RenderPort = (absPath: string) => Promise<RenderOutcome>;

// ---- the standalone-build port (src/rendering/bundle.ts implements it) ---

export type MermaidMode = "cdn" | "bundle" | "none";

export interface BundleInput {
	docPath: string;
	mermaid: MermaidMode;
	/** From detectMermaidNeeds; only consulted in "bundle" mode. */
	needs: { mindmap: boolean; math: boolean };
	iconNames: ReadonlySet<string>;
}

export interface BundleOutput {
	js: string;
	css: string;
	warnings: string[];
}

/** Compiles one doc into a single self-contained iife bundle + stylesheet. */
export type BundlePort = (input: BundleInput) => Promise<BundleOutput>;

// ---- wire protocol between src/rendering/render.ts (the main thread) and
// src/rendering/render-worker.ts (the worker thread) -----------------------
//
// "render" flows main -> worker: render `docPath` and reply with a `result`.
// "invoke" flows worker -> main: the ModuleRunner in render-worker.ts needs
// the main thread's Vite dev server to transform/resolve a module;
// "invoke-response" is the answer.

export interface RenderRequestMessage {
	type: "render";
	id: number;
	ssrEntryPath: string;
	docPath: string;
}

/**
 * Import `client/ssr-entry.tsx` (react, react-dom/server, every builtin —
 * the bulk of the SSR dependency graph, and the SSR dep optimizer's first
 * run) ahead of any doc, so that cost never lands inside a doc's render
 * budget. Replies with a `result` like a render does.
 */
export interface WarmRequestMessage {
	type: "warm";
	id: number;
	ssrEntryPath: string;
}

export interface RenderResultMessage {
	type: "result";
	id: number;
	outcome: RenderOutcome;
}

export interface InvokeRequestMessage {
	type: "invoke";
	invokeId: number;
	payload: HotPayload;
}

export interface InvokeResponseMessage {
	type: "invoke-response";
	invokeId: number;
	response: { result: unknown } | { error: unknown };
}

export type WorkerInboundMessage =
	RenderRequestMessage | WarmRequestMessage | InvokeResponseMessage;
export type WorkerOutboundMessage = InvokeRequestMessage | RenderResultMessage;
