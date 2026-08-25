const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** The hostname part of a `Host` header: port stripped, IPv6 brackets removed, lower-cased. */
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
