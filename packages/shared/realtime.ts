import { z } from "zod";

/**
 * The live update channel between the server and a viewer: one socket.io
 * connection per tab. The server's events are signals with no payload, so a
 * client that receives one refetches what it holds. The client's events ask
 * to receive, or stop receiving, one document's signal.
 *
 * Both packages/server/src/realtime/ and apps/web/src/realtime.ts import these values, and each
 * side validates what it receives against them.
 */

/** The socket.io path, under the server's own prefix so one proxy rule covers the API and the socket. */
export const REALTIME_PATH = "/__mdxserve/socket.io";

/** Server to client. None carries a payload. */
export const SERVER_EVENTS = {
	/** A document the connection joined changed on disk. Sent to that document's room. */
	docChanged: "doc-changed",
	/** A file or folder was added or removed under a mounted root. Sent to every connection. */
	listingChanged: "listing-changed",
	/** The set of mounted roots changed. Sent to every connection. */
	rootsChanged: "roots-changed",
} as const;

/** The arguments a server event arrives with: none. */
export const serverEventArgsSchema = z.tuple([]);

/** Client to server. Each takes a `RoomRequest` and is acknowledged with a `RoomAck`. */
export const CLIENT_EVENTS = {
	join: "join",
	leave: "leave",
} as const;

/** The document to join or leave, in the same form `getDocument` takes its `path`. */
export const roomRequestSchema = z.object({ path: z.string().min(1).max(4096) });

/** `ok` is false when the server refused: a malformed request, or a document the peer could not fetch. */
export const roomAckSchema = z.object({ ok: z.boolean() });

type RoomRequest = z.infer<typeof roomRequestSchema>;
export type RoomAck = z.infer<typeof roomAckSchema>;

/** socket.io's typed-events map for what the server emits. */
export type ServerToClientEvents = {
	[Name in (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS]]: () => void;
};

/**
 * socket.io's typed-events map for what a client emits. The payload is typed
 * as what a client sends; the server still treats it as unknown until
 * `roomRequestSchema` accepts it.
 */
export type ClientToServerEvents = {
	[Name in (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS]]: (
		request: RoomRequest,
		ack: (result: RoomAck) => void,
	) => void;
};
