import type http from "node:http";
import type { PermissionMode } from "../servers/bind-host.js";

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * The hostname part of a `Host` header: port stripped, IPv6 brackets removed, lower-cased.
 * @internal Exported for its tests.
 */
export function hostnameOf(hostHeader: string): string {
	const trimmed = hostHeader.trim().toLowerCase();
	if (trimmed.startsWith("[")) {
		const close = trimmed.indexOf("]");
		return close === -1 ? trimmed : trimmed.slice(1, close);
	}
	const colon = trimmed.lastIndexOf(":");
	// An unbracketed IPv6 literal has several colons and no port.
	if (colon === -1 || trimmed.indexOf(":") !== colon) return trimmed;
	return trimmed.slice(0, colon);
}

/**
 * Whether a request's `Host` header names this machine, so that a same-machine
 * privilege (rendering served docs, mounting roots) may be granted to it.
 *
 * A loopback remote address alone is not enough: a DNS-rebinding page makes
 * the browser resolve `attacker.example` to 127.0.0.1 and then send ordinary
 * same-origin requests here, which arrive from loopback but carry
 * `Host: attacker.example:<port>`. A legitimate same-machine caller — the
 * browser on a printed URL, the stdio bridge on the registered host — always
 * names a loopback host or the exact address the connection arrived on
 * (`localAddress`; for the bridge that is the `--host` address it looked up).
 */
export function isTrustedHost(
	hostHeader: string | undefined,
	localAddress: string | undefined,
): boolean {
	if (!hostHeader) return false;
	const hostname = hostnameOf(hostHeader);
	if (LOOPBACK_NAMES.has(hostname)) return true;
	if (localAddress === undefined) return false;
	const local = localAddress.toLowerCase();
	return hostname === local || (local.startsWith("::ffff:") && hostname === local.slice(7));
}

/**
 * A same-origin request either omits `Origin` (a plain navigation, or a
 * fetch without CORS) or sends one whose host matches the `Host` header it
 * arrived on. Anything else, including an unparsable or `null` origin, is
 * cross-origin.
 */
export function isSameOrigin(origin: string | undefined, hostHeader: string | undefined): boolean {
	if (origin === undefined) return true;
	let originHost: string;
	try {
		originHost = new URL(origin).host;
	} catch {
		return false;
	}
	return originHost === hostHeader;
}

/**
 * Whether a live update socket may connect.
 *
 * Every mode requires an `Origin`, when sent, that names the `Host` the
 * request arrived on, so another site's page cannot listen.
 *
 * A full server also requires a `Host` that names this machine
 * (`isTrustedHost`, the check that guards same-machine privileges over
 * HTTP). That is the DNS-rebinding defence for a server bound to loopback,
 * whose rooms may cover any document in its roots.
 *
 * The one other `Host` a full server accepts is an address Tailscale itself
 * reports as proxying `/` to this server (`tailnetHosts`), and only on a
 * connection from loopback, which is where `tailscale serve` connects from.
 * A rebinding page would need to control the local serve config to use it.
 * Such a `Host` still fails `isTrustedHost`, so a tailnet reader never gets
 * same-machine privileges over HTTP.
 *
 * A restricted server skips the `Host` check: it is meant to be reached by
 * name (`mybox.local`, a domain behind a reverse proxy), its rooms only
 * cover public documents, and its signals carry nothing, so the check would
 * only refuse legitimate readers.
 */
function acceptsRealtimePeer(
	req: http.IncomingMessage,
	permissions: PermissionMode,
	tailnetHosts: ReadonlySet<string>,
): boolean {
	if (!isSameOrigin(req.headers.origin, req.headers.host)) return false;
	if (permissions === "restricted") return true;
	if (isTrustedHost(req.headers.host, req.socket.localAddress)) return true;
	return (
		isLoopbackAddress(req.socket.remoteAddress) && isTailnetHost(req.headers.host, tailnetHosts)
	);
}

/** Whether a `Host` header is one `tailscale serve` publishes this server under. */
function isTailnetHost(hostHeader: string | undefined, tailnetHosts: ReadonlySet<string>): boolean {
	return hostHeader !== undefined && tailnetHosts.has(hostHeader.trim().toLowerCase());
}

function isLoopbackAddress(address: string | undefined): boolean {
	return address !== undefined && LOOPBACK_NAMES.has(address.toLowerCase());
}

/** The per-process set of tailnet `Host` values, read once at server startup. */
interface TailnetHostSource {
	current(): ReadonlySet<string>;
}

/**
 * The handshake check the live update socket runs. Without a source
 * (`--no-tailscale`) no tailnet `Host` is accepted.
 */
export function realtimePeerCheck(
	permissions: PermissionMode,
	tailnet: TailnetHostSource | undefined,
): (req: http.IncomingMessage) => boolean {
	const empty: ReadonlySet<string> = new Set();
	return (req) => acceptsRealtimePeer(req, permissions, tailnet?.current() ?? empty);
}
