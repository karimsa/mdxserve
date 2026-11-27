import { io } from "socket.io-client";
import {
	CLIENT_EVENTS,
	REALTIME_PATH,
	SERVER_EVENTS,
	roomAckSchema,
	roomRequestSchema,
	serverEventArgsSchema,
} from "@mdxserve/shared/realtime";

/**
 * Why the open document may be stale: the server said it changed, or this
 * tab could not hear it change (the socket reconnected, or the tab rejoined a
 * document it had left).
 * @internal Exported for its tests.
 */
export type DocChangeCause = "changed" | "stale";

type DocListener = (path: string, cause: DocChangeCause) => void;
type Listener = () => void;

/**
 * The part of a socket.io client socket this module uses, so tests can pass a fake.
 * @internal Exported for its tests.
 */
export interface RealtimeSocket {
	readonly connected: boolean;
	/** The socket's manager, which owns the reconnection backoff. */
	readonly io: {
		reconnectionDelay(ms: number): unknown;
		reconnectionDelayMax(ms: number): unknown;
	};
	on(event: string, listener: (...args: unknown[]) => void): unknown;
	emit(event: string, payload: unknown, ack: (result: unknown) => void): unknown;
}

/**
 * socket.io's own reconnection backoff, used while the server is merely unreachable.
 * @internal Exported for its tests.
 */
export const RETRY_DELAY_MS = 1000;
/** @internal Exported for its tests. */
export const RETRY_DELAY_MAX_MS = 5000;
/**
 * The retry delay once the server has refused this tab's handshake.
 * @internal Exported for its tests.
 */
export const REFUSED_RETRY_DELAY_MS = 60_000;

/**
 * Whether a connection error is the server refusing the handshake (the
 * engine.io handshake answered 403, see `acceptsRealtimePeer`), as opposed
 * to a server that is down or restarting, which answers nothing.
 */
function isRefusedHandshake(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { description?: unknown }).description === 403
	);
}

export interface RealtimeClient {
	/** Receive the open document's change signal. Opening another document leaves this one. */
	joinDocument(path: string): void;
	leaveDocument(path: string): void;
	/** Each returns its unsubscribe function. */
	onDocChanged(listener: DocListener): () => void;
	onListingChanged(listener: Listener): () => void;
	onRootsChanged(listener: Listener): () => void;
}

function subscribe<Fn>(set: Set<Fn>, listener: Fn): () => void {
	set.add(listener);
	return () => {
		set.delete(listener);
	};
}

/**
 * The live update connection. The server's signals carry no payload, so
 * this module supplies what each one is about: `doc-changed` only reaches
 * the room of the document this tab has open, which is the path its
 * listeners receive. Signals are best-effort, so whenever this tab may have
 * missed one it signals "stale" itself: on every reconnect (for the open
 * document, the listings and the roots), and when it rejoins a document it
 * had left.
 * @internal Exported for its tests.
 */
export function createRealtimeClient(socket: RealtimeSocket): RealtimeClient {
	const docListeners = new Set<DocListener>();
	const listingListeners = new Set<Listener>();
	const rootsListeners = new Set<Listener>();
	let openPath: string | null = null;
	const joinedBefore = new Set<string>();
	let connectedBefore = false;
	let missedSignals = false;

	function send(event: string, path: string): void {
		if (!socket.connected) return;
		const request = roomRequestSchema.safeParse({ path });
		if (!request.success) return;
		socket.emit(event, request.data, (result) => {
			const ack = roomAckSchema.safeParse(result);
			if (!ack.success || !ack.data.ok) {
				console.warn(`mdxserve: the server refused to ${event} live updates for ${path}`);
			}
		});
	}

	function notifyDoc(path: string, cause: DocChangeCause): void {
		for (const listener of [...docListeners]) listener(path, cause);
	}

	function onSignal(event: string, listeners: () => void): void {
		socket.on(event, (...args: unknown[]) => {
			if (!serverEventArgsSchema.safeParse(args).success) {
				console.warn(`mdxserve: ignored a malformed ${event} signal`);
				return;
			}
			listeners();
		});
	}

	// A server that is down or restarting is retried at socket.io's usual
	// pace, so a restart is picked up within seconds. A refusal is decided by
	// this tab's Host and Origin, which a retry does not change, so retrying
	// every few seconds only adds load; it can still change if the server is
	// restarted with other permissions or a proxy is fixed, so keep retrying,
	// once a minute, rather than stop and require a reload.
	socket.on("connect_error", (error: unknown) => {
		// The tab is now running without signals, whatever the reason.
		missedSignals = true;
		if (!isRefusedHandshake(error)) return;
		socket.io.reconnectionDelay(REFUSED_RETRY_DELAY_MS);
		socket.io.reconnectionDelayMax(REFUSED_RETRY_DELAY_MS);
	});

	socket.on("connect", () => {
		socket.io.reconnectionDelay(RETRY_DELAY_MS);
		socket.io.reconnectionDelayMax(RETRY_DELAY_MAX_MS);
		// Stale after any connection that was lost, and after a first connection
		// that only succeeded after failing: the page loaded what it shows before
		// signals were available. A first connection that succeeds at once
		// races only the page's own load, so it refreshes nothing.
		const stale = connectedBefore || missedSignals;
		connectedBefore = true;
		missedSignals = false;
		if (openPath !== null) send(CLIENT_EVENTS.join, openPath);
		if (!stale) return;
		if (openPath !== null) notifyDoc(openPath, "stale");
		for (const listener of [...listingListeners]) listener();
		for (const listener of [...rootsListeners]) listener();
	});

	onSignal(SERVER_EVENTS.docChanged, () => {
		if (openPath !== null) notifyDoc(openPath, "changed");
	});
	onSignal(SERVER_EVENTS.listingChanged, () => {
		for (const listener of [...listingListeners]) listener();
	});
	onSignal(SERVER_EVENTS.rootsChanged, () => {
		for (const listener of [...rootsListeners]) listener();
	});

	return {
		joinDocument(path) {
			if (openPath === path) return;
			if (openPath !== null) send(CLIENT_EVENTS.leave, openPath);
			openPath = path;
			send(CLIENT_EVENTS.join, path);
			if (joinedBefore.has(path)) notifyDoc(path, "stale");
			joinedBefore.add(path);
		},
		leaveDocument(path) {
			if (openPath !== path) return;
			openPath = null;
			send(CLIENT_EVENTS.leave, path);
		},
		onDocChanged: (listener) => subscribe(docListeners, listener),
		onListingChanged: (listener) => subscribe(listingListeners, listener),
		onRootsChanged: (listener) => subscribe(rootsListeners, listener),
	};
}

/**
 * One connection per tab, kept on `window` like the query client in api.ts
 * so a Vite HMR re-execution of this module does not open a second socket.
 */
interface RealtimeWindow extends Window {
	__mdxserveRealtime?: RealtimeClient;
}

function browserClient(): RealtimeClient {
	const realtimeWindow = window as RealtimeWindow;
	return (realtimeWindow.__mdxserveRealtime ??= createRealtimeClient(
		io({
			path: REALTIME_PATH,
			reconnectionDelay: RETRY_DELAY_MS,
			reconnectionDelayMax: RETRY_DELAY_MAX_MS,
		}) as unknown as RealtimeSocket,
	));
}

/** A client that never connects, for code that runs where there is no `window`. */
const offline: RealtimeClient = {
	joinDocument() {},
	leaveDocument() {},
	onDocChanged: () => () => {},
	onListingChanged: () => () => {},
	onRootsChanged: () => () => {},
};

export const realtime: RealtimeClient = typeof window === "undefined" ? offline : browserClient();
