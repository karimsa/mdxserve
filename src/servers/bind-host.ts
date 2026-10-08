import { isIP } from "node:net";

/** Resolve only known loopback names locally; never trust a hostname's DNS result. */
export function loopbackBindHost(host: string): string | undefined {
	if (host.toLowerCase() === "localhost") return "127.0.0.1";
	if (isIP(host) === 4 && host.startsWith("127.")) return host;
	if (isIP(host) === 6 && new URL(`http://[${host}]`).hostname === "[::1]") return "::1";
	return undefined;
}

export function admitBindHost(
	host: string,
	dangerousAllowNetwork = false,
): { kind: "ok"; host: string } | { kind: "error"; message: string } {
	const loopback = loopbackBindHost(host);
	if (loopback !== undefined) return { kind: "ok", host: loopback };
	if (dangerousAllowNetwork) return { kind: "ok", host };
	return {
		kind: "error",
		message: `refusing non-loopback host ${JSON.stringify(host)} without --dangerous-allow-network. This exposes all configured roots, including saved roots and future config additions, without authentication. Use --host 127.0.0.1 for local access.`,
	};
}
