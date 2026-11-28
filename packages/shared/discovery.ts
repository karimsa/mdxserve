/**
 * How a server is handed to the app without typing its address. `mdxserve qr` builds the
 * QR code's text here and the app reads it back with the same rules, so the two cannot drift.
 */

/** The fragment key that carries the server id: `<origin>/#mdxserve=<id>`. */
const QR_SERVER_ID_KEY = "mdxserve";

/**
 * The text a QR code of a server holds: its origin and its id, and nothing secret. It is an
 * ordinary URL, so a phone's own camera opens the web client from it; the id sits in the
 * fragment, which a browser never sends to the server. The app asks the origin for
 * `getServerInfo` and adds the server only when the answer carries this id.
 */
export function buildQrPayload(input: { origin: string; serverId: string }): string {
	const params = new URLSearchParams({ [QR_SERVER_ID_KEY]: input.serverId });
	return `${new URL(input.origin).origin}/#${params.toString()}`;
}
