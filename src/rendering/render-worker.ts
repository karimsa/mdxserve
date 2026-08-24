import fs from "node:fs";
import path from "node:path";
import { parentPort } from "node:worker_threads";
import type { ComponentType } from "react";
import { ESModulesEvaluator, ModuleRunner } from "vite/module-runner";
import type { ModuleRunnerTransport } from "vite/module-runner";
import type { HotPayload } from "vite";
import type {
	InvokeRequestMessage,
	RenderOutcome,
	RenderRequestMessage,
	RenderResultMessage,
	WarmRequestMessage,
	WorkerInboundMessage,
} from "./protocol.js";

if (!parentPort) {
	throw new Error("render-worker.ts must be run inside a node:worker_threads Worker");
}
const port = parentPort;

// The wire protocol (RenderRequestMessage, WarmRequestMessage,
// RenderResultMessage, InvokeRequestMessage, InvokeResponseMessage,
// WorkerInboundMessage, WorkerOutboundMessage) lives in src/rendering/protocol.ts,
// shared with src/rendering/render.ts (the main thread) so neither file
// imports the other.
//
// "render" flows main -> worker: render `docPath` and reply with a `result`.
// "invoke" flows worker -> main: the ModuleRunner below needs the main
// thread's Vite dev server to transform/resolve a module; "invoke-response"
// is the answer.

function toPosix(p: string): string {
	return p.split(path.sep).join("/");
}

// ---- transport: forward every ModuleRunner "invoke" to the main thread --
//
// Per node_modules/vite/dist/node/module-runner.d.ts (`ModuleRunnerTransport`),
// a transport must implement either the duplex `send`/`connect` pair or the
// simpler request/response `invoke`. `send`/`connect` exists to carry HMR
// push events (file-change notifications the client didn't ask for); since
// this runner is spun up once per render batch with `hmr: false` below,
// nothing ever needs that direction, so `invoke` alone is sufficient — the
// module-runner source confirms this itself (`createInvokeableTransport` in
// dist/node/module-runner.js only requires `send`+`connect` when `invoke` is
// absent).
//
// The wire shape of an invoke call is fixed by Vite, not us: internally the
// ModuleRunner wraps every `fetchModule`/`getBuiltins` call into a HotPayload
// shaped `{ type: "custom", event: "vite:invoke", data: { id, name, data } }`
// and hands it to `transport.invoke(payload)` verbatim (see
// `createInvokeableTransport` in module-runner.js). The exact counterpart
// that answers this payload on the server is
// `NormalizedHotChannel.handleInvoke` (declared on `DevEnvironment.hot` in
// dist/node/index.d.ts) — `DevEnvironment`'s constructor always wires
// `this.hot.setInvokeHandler({ fetchModule, getBuiltins })`, independent of
// whatever transport that environment's *own* `hot` channel otherwise uses,
// so `server.environments.ssr.hot.handleInvoke(payload)` is a plain async
// function that answers this payload correctly regardless of who calls it.
//
// We deliberately do NOT use Vite's own `createServerModuleRunnerTransport`
// helper (also in dist/node/chunks/node.js): it wires `send`/`connect`
// directly to `environment.hot.api.{innerEmitter,outsideEmitter}`, i.e. two
// `EventEmitter`s accessed synchronously in-process — that cannot cross a
// worker_threads boundary. Calling `handleInvoke` by hand and shuttling its
// plain-object result over `postMessage` is the cross-thread-safe equivalent.
let nextInvokeId = 0;
const pendingInvokes = new Map<
	number,
	{ resolve: (v: { result: unknown } | { error: unknown }) => void }
>();

const transport: ModuleRunnerTransport = {
	invoke(data: HotPayload) {
		const invokeId = nextInvokeId++;
		return new Promise<{ result: unknown } | { error: unknown }>((resolve) => {
			pendingInvokes.set(invokeId, { resolve });
			const message: InvokeRequestMessage = { type: "invoke", invokeId, payload: data };
			port.postMessage(message);
		}) as Promise<{ result: any } | { error: any }>;
	},
};

const runner = new ModuleRunner(
	{
		transport,
		hmr: false,
		// Have Node remap `Error.stack` frames through each module's sourcemap
		// as they're generated, so an error thrown while evaluating a doc
		// already points at the original .md/.mdx source — no separate
		// `vite.ssrFixStacktrace()` pass needed (that was a main-thread-only
		// API tied to the main-thread module graph). "node" is what Vite's own
		// `createServerModuleRunner` resolves to by default in a real Node
		// process (see `resolveSourceMapOptions` in dist/node/chunks/node.js);
		// passing it explicitly here just makes that intentional rather than
		// incidental.
		sourcemapInterceptor: "node",
	},
	new ESModulesEvaluator(),
);

// ---- rendering ------------------------------------------------------------
//
// Moved here from src/rendering/render.ts: this now runs inside the disposable worker,
// so a genuine synchronous infinite loop in a doc only hangs this thread,
// which the main thread can (and does, on timeout) kill with
// `Worker#terminate()`.

// React logs this during every SSR render of a component that uses
// useLayoutEffect (which several builtins do, e.g. TaskCheckbox); it's
// expected and not actionable here, so drop only this exact message and
// re-emit anything else untouched.
const USE_LAYOUT_EFFECT_WARNING = "useLayoutEffect does nothing on the server";

function withConsoleErrorFilter<T>(fn: () => T): T {
	const original = console.error;
	console.error = (...args: unknown[]) => {
		const first = args[0];
		if (typeof first === "string" && first.includes(USE_LAYOUT_EFFECT_WARNING)) return;
		original.apply(console, args);
	};
	try {
		return fn();
	} finally {
		console.error = original;
	}
}

/**
 * Find the first stack frame pointing at `absPath` and pull out its
 * line/column. `@mdx-js/rollup`'s dev output doesn't give us a structured
 * fileName/lineNumber/columnNumber any other way through `renderToString`
 * (see src/rendering/render.ts's history), so this is the only source of a line number.
 */
function firstFrameFor(stack: string, absPath: string): { line?: number; column?: number } {
	const escaped = absPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(`${escaped}:(\\d+):(\\d+)`);
	for (const rawLine of stack.split("\n")) {
		const match = re.exec(rawLine);
		if (match) {
			return { line: Number(match[1]), column: Number(match[2]) };
		}
	}
	return {};
}

/**
 * Every spelling a stack frame might use for `docPath`: as given, with
 * forward slashes (what `runner.import` is handed, and what module ids and
 * remapped frames use — the two differ on Windows), and the realpath of each
 * (the server graph keys on realpaths, e.g. /private/var/… for /var/… on
 * macOS).
 */
function pathForms(docPath: string): string[] {
	let real = docPath;
	try {
		real = fs.realpathSync.native(docPath);
	} catch {
		// keep docPath
	}
	return [...new Set([docPath, toPosix(docPath), real, toPosix(real)])];
}

function outcomeFromError(err: unknown, docPath: string): RenderOutcome {
	if (!(err instanceof Error)) {
		return { ok: false, message: String(err) };
	}
	const stack = err.stack;
	let line: number | undefined;
	let column: number | undefined;
	if (stack) {
		for (const form of pathForms(docPath)) {
			({ line, column } = firstFrameFor(stack, form));
			if (line !== undefined) break;
		}
	}
	return { ok: false, message: err.message, stack, line, column };
}

async function handleRender(msg: RenderRequestMessage): Promise<void> {
	const { id, ssrEntryPath, docPath } = msg;
	let outcome: RenderOutcome;
	try {
		invalidateDocModules();
		const [ssrEntry, docModule] = await Promise.all([
			runner.import(toPosix(ssrEntryPath)) as Promise<{
				renderDoc: (Content: ComponentType) => string;
			}>,
			runner.import(toPosix(docPath)) as Promise<{ default?: ComponentType }>,
		]);

		if (!docModule.default) {
			outcome = { ok: false, message: `${docPath} has no default export.` };
		} else {
			withConsoleErrorFilter(() => ssrEntry.renderDoc(docModule.default as ComponentType));
			outcome = { ok: true };
		}
	} catch (err) {
		outcome = outcomeFromError(err, docPath);
	}
	const result: RenderResultMessage = { type: "result", id, outcome };
	port.postMessage(result);
}

// Module ids evaluated by the warm-up — `client/ssr-entry.tsx` and its whole
// dependency tree (react, every builtin). These are the only modules that
// may stay cached across renders.
let sharedIds: Set<string> | undefined;

/**
 * Drop every evaluated module that isn't part of the shared entry tree —
 * i.e. the docs rendered so far and anything they imported locally. This
 * runner has `hmr: false` and an invoke-only transport, so it never receives
 * the update/full-reload payloads that would otherwise evict stale entries;
 * without this, re-validating a doc after editing it re-used the old module
 * and reported the old outcome.
 */
function invalidateDocModules(): void {
	for (const [id, node] of runner.evaluatedModules.idToModuleMap) {
		if (sharedIds?.has(id)) continue;
		runner.evaluatedModules.invalidateModule(node);
	}
}

async function handleWarm(msg: WarmRequestMessage): Promise<void> {
	let outcome: RenderOutcome;
	try {
		await runner.import(toPosix(msg.ssrEntryPath));
		sharedIds = new Set(runner.evaluatedModules.idToModuleMap.keys());
		outcome = { ok: true };
	} catch (err) {
		outcome =
			err instanceof Error
				? { ok: false, message: err.message, stack: err.stack }
				: { ok: false, message: String(err) };
	}
	const result: RenderResultMessage = { type: "result", id: msg.id, outcome };
	port.postMessage(result);
}

port.on("message", (msg: WorkerInboundMessage) => {
	if (msg.type === "invoke-response") {
		const pending = pendingInvokes.get(msg.invokeId);
		if (!pending) return;
		pendingInvokes.delete(msg.invokeId);
		pending.resolve(msg.response);
		return;
	}
	if (msg.type === "warm") {
		void handleWarm(msg);
		return;
	}
	if (msg.type === "render") {
		void handleRender(msg);
	}
});
