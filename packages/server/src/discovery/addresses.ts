import { isIP } from "node:net";
import type os from "node:os";
import { loopbackBindHost } from "../servers/bind-host.js";
import { serverBaseUrl } from "../servers/remote.js";

/** What `os.networkInterfaces()` returns. */
export type NetworkInterfaces = ReturnType<typeof os.networkInterfaces>;

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::"]);

/** Tailscale's CGNAT range (`100.64.0.0/10`) and IPv4 link-local (`169.254.0.0/16`). */
function isTailscaleOrLinkLocal(address: string): boolean {
	const [first, second] = address.split(".").map(Number);
	if (first === 169 && second === 254) return true;
	return first === 100 && second !== undefined && second >= 64 && second <= 127;
}

/**
 * The address another device on the LAN reaches a server bound to `boundHost` at, or
 * undefined when it listens only on loopback. A concrete address is reachable only on itself.
 * A wildcard bind is reachable on every interface; the first external IPv4 address that is
 * neither a Tailscale address (the tailnet has its own URLs) nor link-local is the LAN one.
 */
export function lanAddress(boundHost: string, interfaces: NetworkInterfaces): string | undefined {
	if (loopbackBindHost(boundHost) !== undefined) return undefined;
	if (!WILDCARD_HOSTS.has(boundHost)) return boundHost;
	for (const entries of Object.values(interfaces)) {
		for (const entry of entries ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			if (isIP(entry.address) !== 4 || loopbackBindHost(entry.address) !== undefined) continue;
			if (isTailscaleOrLinkLocal(entry.address)) continue;
			return entry.address;
		}
	}
	return undefined;
}

export interface ReachableOrigin {
	url: string;
	via: "tailnet" | "lan";
}

/**
 * The origins another device can open this server at: the `tailscale serve` addresses first,
 * then the LAN address when the server is bound to more than loopback. Never a loopback origin.
 */
export function reachableOrigins(input: {
	boundHost: string;
	port: number;
	tailnetUrls: readonly string[];
	interfaces: NetworkInterfaces;
}): ReachableOrigin[] {
	const origins: ReachableOrigin[] = input.tailnetUrls
		.filter((url) => URL.canParse(url) && new URL(url).protocol === "https:")
		.map((url) => ({ url: new URL(url).origin, via: "tailnet" }));
	const lan = lanAddress(input.boundHost, input.interfaces);
	if (lan !== undefined) {
		origins.push({ url: serverBaseUrl({ host: lan, port: input.port }), via: "lan" });
	}
	return origins;
}

export type ShareOriginResult =
	| { kind: "ok"; origin: ReachableOrigin }
	/** Nothing but this computer can open the server. */
	| { kind: "unreachable" }
	/** The LAN address was asked for and the server listens only on loopback. */
	| { kind: "no-lan" };

/**
 * The one origin to hand to another device: the first tailnet address, which is HTTPS and
 * works off the LAN too, unless the LAN address is preferred or there is no tailnet address.
 */
export function shareOrigin(
	origins: readonly ReachableOrigin[],
	options: { preferLan: boolean },
): ShareOriginResult {
	const lan = origins.find((origin) => origin.via === "lan");
	if (options.preferLan) {
		return lan === undefined ? { kind: "no-lan" } : { kind: "ok", origin: lan };
	}
	const chosen = origins.find((origin) => origin.via === "tailnet") ?? lan;
	return chosen === undefined ? { kind: "unreachable" } : { kind: "ok", origin: chosen };
}
