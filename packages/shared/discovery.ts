import { serverInfoSchema } from "./server-info";

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

/** A code longer than this is not one `buildQrPayload` made. */
const QR_PAYLOAD_MAX = 512;

export type QrPayloadResult =
	{ kind: "ok"; origin: string; serverId: string | undefined } | { kind: "error"; message: string };

const NOT_AN_ADDRESS = "That code is not an mdxserve address.";

/**
 * Read a scanned code back: an `http://` or `https://` URL with no user name or password, of
 * which only the origin is kept, and the server id from its fragment when there is one. A code
 * that is a plain address (no id) is read too; the app then takes whatever server answers.
 */
export function parseQrPayload(text: string): QrPayloadResult {
	if (text.length > QR_PAYLOAD_MAX || !URL.canParse(text)) {
		return { kind: "error", message: NOT_AN_ADDRESS };
	}
	const url = new URL(text);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return { kind: "error", message: NOT_AN_ADDRESS };
	}
	if (url.username !== "" || url.password !== "" || url.hostname === "") {
		return { kind: "error", message: NOT_AN_ADDRESS };
	}
	const serverId = new URLSearchParams(url.hash.slice(1)).get(QR_SERVER_ID_KEY);
	if (serverId === null) return { kind: "ok", origin: url.origin, serverId: undefined };
	const parsed = serverInfoSchema.shape.id.safeParse(serverId);
	return parsed.success
		? { kind: "ok", origin: url.origin, serverId: parsed.data }
		: { kind: "error", message: NOT_AN_ADDRESS };
}
