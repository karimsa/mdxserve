import type http from "node:http";
import { Server, type Socket } from "socket.io";
import {
	CLIENT_EVENTS,
	REALTIME_PATH,
	SERVER_EVENTS,
	roomRequestSchema,
	type ClientToServerEvents,
	type RoomAck,
	type ServerToClientEvents,
} from "../../shared/realtime.js";
import type { DocsService } from "../docs/service.js";
import type { PermissionMode } from "../servers/bind-host.js";

export interface RealtimeDeps {
	/** Resolves a joined path with the rules `getDocument` applies. */
	docs: Pick<DocsService, "locateDocument">;
	/** Restricted mode applies the public reader's path rules to a join, as it does to `getDocument`. */
	permissions: PermissionMode;
	/** Runs on every handshake; false refuses the connection. */
	acceptsPeer: (req: http.IncomingMessage) => boolean;
}

/** What `start.ts` calls when the watcher or the roots service reports a change. */
export interface Realtime {
	/** Signal the connections that joined the document at this absolute path. */
	docChanged(absPath: string): void;
	/** Signal every connection that a listing may have changed. */
	listingChanged(): void;
	/** Signal every connection that the set of mounted roots changed. */
	rootsChanged(): void;
	/** Drop every connection so clients reconnect later. The http server itself is left to its owner. */
	close(): void;
}

interface SocketData {
	/** Each path this socket joined, mapped to the room it resolved to. */
	joined: Map<string, string>;
}

type RealtimeSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

/**
 * The most paths one connection may hold joined at once. A tab holds one
 * (the open document); the cap bounds what a peer of a public server can
 * make the server remember.
 * @internal Exported for its tests.
 */
export const MAX_JOINED_PATHS = 16;

/** The room for one document, named from its resolved absolute path. */
function documentRoom(absPath: string): string {
	return `doc:${absPath}`;
}

/** An ack callback socket.io handed us, or a no-op when the client sent none. */
function ackOf(value: unknown): (result: RoomAck) => void {
	return typeof value === "function" ? (value as (result: RoomAck) => void) : () => {};
}

/**
 * Attach the live update socket to the server's one http server. Call it
 * after the http server's own `request` listener is registered: engine.io
 * takes over the existing `request` listeners and forwards every request
 * outside `REALTIME_PATH` to them.
 *
 * Nothing else upgrades on this http server, so engine.io keeps its default of
 * closing any upgrade outside `REALTIME_PATH`.
 */
export function attachRealtime(httpServer: http.Server, deps: RealtimeDeps): Realtime {
	const io = new Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>(httpServer, {
		path: REALTIME_PATH,
		serveClient: false,
		allowRequest: (req, callback) => callback(null, deps.acceptsPeer(req)),
	});
	const publicOnly = deps.permissions === "restricted";

	io.on("connection", (socket: RealtimeSocket) => {
		socket.data.joined = new Map();
		// A join resolves the path asynchronously. Handle one request at a time
		// so a leave sent right after a join cannot be overtaken by it.
		let pending: Promise<void> = Promise.resolve();
		const inOrder =
			(handler: (request: unknown) => Promise<RoomAck>) => (request: unknown, ack: unknown) => {
				const reply = ackOf(ack);
				pending = pending.then(() => handler(request)).then(reply, () => reply({ ok: false }));
			};

		socket.on(
			CLIENT_EVENTS.join,
			inOrder(async (request) => {
				const parsed = roomRequestSchema.safeParse(request);
				if (!parsed.success) return { ok: false };
				const { joined } = socket.data;
				if (!joined.has(parsed.data.path) && joined.size >= MAX_JOINED_PATHS) return { ok: false };
				const located = await deps.docs.locateDocument(parsed.data.path, publicOnly);
				if (located.kind !== "ok") return { ok: false };
				const room = documentRoom(located.abs);
				socket.data.joined.set(parsed.data.path, room);
				await socket.join(room);
				return { ok: true };
			}),
		);

		// Leaving is looked up by the path the client joined with, not resolved
		// again: the document may be gone by now, and the room must still close.
		socket.on(
			CLIENT_EVENTS.leave,
			inOrder(async (request) => {
				const parsed = roomRequestSchema.safeParse(request);
				if (!parsed.success) return { ok: false };
				const room = socket.data.joined.get(parsed.data.path);
				socket.data.joined.delete(parsed.data.path);
				const stillJoined = room !== undefined && [...socket.data.joined.values()].includes(room);
				if (room !== undefined && !stillJoined) await socket.leave(room);
				return { ok: true };
			}),
		);
	});

	return {
		docChanged(absPath) {
			io.to(documentRoom(absPath)).emit(SERVER_EVENTS.docChanged);
		},
		listingChanged() {
			io.emit(SERVER_EVENTS.listingChanged);
		},
		rootsChanged() {
			io.emit(SERVER_EVENTS.rootsChanged);
		},
		// Close the transports only. `disconnectSockets` would tell each
		// client the server disconnected it on purpose, and a socket.io client
		// does not reconnect after that; a dropped transport makes it reconnect
		// to the next server on this port, which is the restart case.
		close() {
			io.engine.close();
		},
	};
}
