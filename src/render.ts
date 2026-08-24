import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { ViteDevServer } from "vite";
import { getPackageRoot } from "./pkg.js";
import type {
	InvokeRequestMessage,
	RenderRequestMessage,
	RenderResultMessage,
	WarmRequestMessage,
	WorkerOutboundMessage,
} from "./render-worker.js";

export type RenderOutcome =
	{ ok: true } | { ok: false; message: string; stack?: string; line?: number; column?: number };

function realpathOrSelf(p: string): string {
	try {
		return fs.realpathSync.native(p);
	} catch {
		return p;
	}
}

function workerScriptPath(): string {
	return path.join(getPackageRoot(), "dist", "render-worker.js");
}

interface PendingRender {
	resolve: (outcome: RenderOutcome) => void;
}

interface WorkerHandle {
	worker: Worker;
	nextId: number;
	pending: Map<number, PendingRender>;
	/** Serializes renders on this handle so protocol messages never interleave. */
	queue: Promise<void>;
	/** Outcome of this worker's warm-up import; `ok: false` means it was disposed. */
	warm: Promise<RenderOutcome>;
	disposed: boolean;
	disposeReason?: string;
}

// One worker per ViteDevServer, spawned lazily on first render and reused
// across calls; a WeakMap lets it get collected along with its server.
const handles = new WeakMap<ViteDevServer, WorkerHandle>();

function disposeHandle(vite: ViteDevServer, handle: WorkerHandle, reason: string): void {
	if (handle.disposed) return;
	handle.disposed = true;
	handle.disposeReason = reason;
	if (handles.get(vite) === handle) handles.delete(vite);
	for (const { resolve } of handle.pending.values()) {
		resolve({ ok: false, message: reason });
	}
	handle.pending.clear();
	try {
		handle.worker.terminate();
	} catch {
		// already exiting
	}
}

function spawnHandle(vite: ViteDevServer, scriptPath: string): WorkerHandle {
	const worker = new Worker(scriptPath);
	// The worker only does request/response work driven by renderDocument
	// calls; it must never keep the host process alive on its own.
	worker.unref();

	const handle: WorkerHandle = {
		worker,
		nextId: 0,
		pending: new Map(),
		queue: Promise.resolve(),
		warm: Promise.resolve({ ok: true }),
		disposed: false,
	};

	worker.on("message", (msg: WorkerOutboundMessage) => {
		if (msg.type === "invoke") {
			const { invokeId, payload } = msg as InvokeRequestMessage;
			// Answer the worker's ModuleRunner directly through the SSR
			// environment's own invoke handler; see src/render-worker.ts's
			// transport comment for why this (rather than
			// createServerModuleRunnerTransport) is the cross-thread-safe API.
			void vite.environments.ssr.hot.handleInvoke(payload).then((response) => {
				if (handle.disposed) return;
				worker.postMessage({ type: "invoke-response", invokeId, response });
			});
			return;
		}
		if (msg.type === "result") {
			const { id, outcome } = msg as RenderResultMessage;
			const pendingRender = handle.pending.get(id);
			if (!pendingRender) return;
			handle.pending.delete(id);
			pendingRender.resolve(outcome);
		}
	});

	worker.on("error", (err) => {
		disposeHandle(
			vite,
			handle,
			`mdxserve: render worker crashed: ${err instanceof Error ? err.message : String(err)}`,
		);
	});

	worker.on("exit", (code) => {
		disposeHandle(
			vite,
			handle,
			code === 0
				? "mdxserve: render worker exited unexpectedly."
				: `mdxserve: render worker exited unexpectedly (code ${code}).`,
		);
	});

	return handle;
}

const WARM_TIMEOUT_MS = 60_000;

/**
 * Post one request to the worker and resolve with its `result`, or with an
 * `{ ok: false }` timeout outcome — in which case the worker is terminated
 * (this is what actually stops a synchronous infinite loop) and the handle
 * dropped so the next caller respawns.
 */
function request(
	vite: ViteDevServer,
	handle: WorkerHandle,
	message: RenderRequestMessage | WarmRequestMessage,
	timeoutMs: number,
	timeoutMessage: string,
): Promise<RenderOutcome> {
	if (handle.disposed) {
		return Promise.resolve({ ok: false, message: "mdxserve: render worker is unavailable." });
	}

	return new Promise<RenderOutcome>((resolve) => {
		let settled = false;
		const finish = (outcome: RenderOutcome) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			handle.pending.delete(message.id);
			resolve(outcome);
		};

		handle.pending.set(message.id, { resolve: finish });

		if (message.type === "render") {
			// The worker re-fetches the doc on every render (see
			// invalidateDocModules there); make sure the server hands it a fresh
			// transform too, rather than racing the file watcher's invalidation
			// when a validate follows a write immediately.
			// The graph keys files by realpath (e.g. /private/var/… for a
			// /var/… doc on macOS), so look up both spellings.
			const graph = vite.environments.ssr.moduleGraph;
			for (const file of new Set([message.docPath, realpathOrSelf(message.docPath)])) {
				for (const mod of graph.getModulesByFile(file) ?? []) graph.invalidateModule(mod);
			}
		}

		const timer = setTimeout(() => {
			// `terminate()` stops the worker's isolate even mid-loop, unlike an
			// in-process Promise.race, which never gets a turn to run. The cost
			// is a respawn (plus warm-up) on the next render; the main-thread
			// Vite server and its module graph — the transform cache — survive.
			finish({ ok: false, message: timeoutMessage });
			disposeHandle(vite, handle, timeoutMessage);
		}, timeoutMs);

		handle.worker.postMessage(message);
	});
}

/** Chain `task` behind everything already queued on `handle`. */
function enqueue(handle: WorkerHandle, task: () => Promise<RenderOutcome>): Promise<RenderOutcome> {
	const result = handle.queue.then(task, task);
	handle.queue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

/**
 * The live handle for `vite`, spawning (and warming) one if there is none.
 * Warm-up imports `client/ssr-entry.tsx` — react, every builtin, and the SSR
 * dep optimizer's first run — under its own generous budget, queued ahead of
 * every render, so a doc's `timeoutMs` only ever measures the doc. Without
 * this the first validate after a server start on a slow machine reported a
 * bogus "timed out" render-error for a perfectly valid doc.
 */
function acquireHandle(vite: ViteDevServer, scriptPath: string): WorkerHandle {
	let handle = handles.get(vite);
	if (!handle || handle.disposed) {
		handle = spawnHandle(vite, scriptPath);
		handles.set(vite, handle);
		const warmHandle = handle;
		const ssrEntryPath = path.join(getPackageRoot(), "client", "ssr-entry.tsx");
		warmHandle.warm = enqueue(warmHandle, () =>
			request(
				vite,
				warmHandle,
				{ type: "warm", id: warmHandle.nextId++, ssrEntryPath },
				WARM_TIMEOUT_MS,
				`mdxserve: render worker warm-up timed out after ${WARM_TIMEOUT_MS}ms.`,
			).then((outcome) => {
				// A worker that can't load the SSR entry can't render anything;
				// drop it so the failure is reported (and retried) per call
				// rather than masked by a stale handle.
				if (!outcome.ok) disposeHandle(vite, warmHandle, outcome.message);
				return outcome;
			}),
		);
	}
	return handle;
}

/**
 * Server-side render `absPath` (an already statically-valid .md/.mdx file)
 * through the same Vite SSR pipeline and MDXProvider component map the
 * browser uses (`client/ssr-entry.tsx`), to catch errors that only surface
 * at render time — e.g. a stray MDX expression evaluating a bare identifier.
 *
 * This cannot catch errors thrown from `useEffect`/`useLayoutEffect` (they
 * never run during `renderToString`) or hydration mismatches; those remain
 * browser-only.
 *
 * Module TRANSFORMS still happen on the main thread's `vite` dev server (its
 * "ssr" `DevEnvironment`, same as every other consumer of this server); only
 * EXECUTION of the doc and `client/ssr-entry.tsx` happens off-thread, in a
 * disposable `node:worker_threads` Worker running a Vite `ModuleRunner`
 * (`src/render-worker.ts`). One worker is spawned lazily per `ViteDevServer`
 * and reused across calls, with renders on the same handle serialized through
 * a promise queue so concurrent `renderDocument` calls never interleave the
 * worker's request/response protocol.
 *
 * `opts.timeoutMs` (default 5000) now genuinely bounds the render: on
 * timeout — OR if the worker errors or exits on its own — the worker is
 * terminated outright and this resolves `{ ok: false }` rather than hanging.
 * That includes a synchronous infinite loop at a doc's top level (e.g.
 * `export const x = (() => { while (true) {} })();`), which the previous
 * main-thread `Promise.race` implementation could NOT preempt (JS is single
 * threaded, so once that statement started executing nothing else — the
 * timer, the Vite dev server, the whole process — ran again). `terminate()`
 * stops the worker's isolate even mid-loop, so this now works; see
 * `tests/render.test.ts` for a fixture confirming it. The worker is
 * respawned lazily on the next call after any such termination — a real but
 * bounded cost (a fresh `ModuleRunner`/module cache in that thread); the
 * main-thread Vite server and its module graph are untouched, so already
 *-transformed modules don't need to be re-transformed.
 *
 * If `dist/render-worker.js` hasn't been built yet, this returns
 * `{ ok: false }` telling the caller to run `yarn build` rather than
 * throwing — the same assumption `tests/render.test.ts` already makes about
 * `dist/registry.json`.
 */
export async function renderDocument(
	vite: ViteDevServer,
	absPath: string,
	opts?: { timeoutMs?: number },
): Promise<RenderOutcome> {
	const timeoutMs = opts?.timeoutMs ?? 5000;
	const scriptPath = workerScriptPath();
	if (!fs.existsSync(scriptPath)) {
		return {
			ok: false,
			message: "mdxserve: dist/render-worker.js is missing — run `yarn build` first.",
		};
	}

	let handle = acquireHandle(vite, scriptPath);
	let respawned = false;
	const task = async (): Promise<RenderOutcome> => {
		// A worker whose warm-up failed is disposed and its failure is the
		// answer — returning it (rather than spawning another worker that
		// would fail the same way) is what keeps a persistent SSR-entry
		// failure from becoming an endless respawn loop.
		const warm = await handle.warm;
		if (!warm.ok) return warm;
		// Disposed by a timeout/crash on a render ahead of us in the queue:
		// retry once on a respawned worker (waiting for its warm-up), then give
		// up with the disposal reason rather than spinning. Messages carry ids,
		// so renders racing across an old and a new worker are protocol-safe.
		if (handle.disposed) {
			if (respawned) {
				return {
					ok: false,
					message: handle.disposeReason ?? "mdxserve: render worker is unavailable.",
				};
			}
			respawned = true;
			handle = acquireHandle(vite, scriptPath);
			// Queue on the new worker like any other render so it stays
			// one-render-at-a-time (behind its warm-up and anything already
			// waiting there) rather than driving it concurrently.
			return enqueue(handle, task);
		}
		const ssrEntryPath = path.join(getPackageRoot(), "client", "ssr-entry.tsx");
		return request(
			vite,
			handle,
			{ type: "render", id: handle.nextId++, ssrEntryPath, docPath: absPath },
			timeoutMs,
			`Rendering ${absPath} timed out after ${timeoutMs}ms.`,
		);
	};
	return enqueue(handle, task);
}
