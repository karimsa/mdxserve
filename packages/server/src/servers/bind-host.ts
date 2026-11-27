import { isIP } from "node:net";

/** Resolve only known loopback names locally; never trust a hostname's DNS result. */
export function loopbackBindHost(host: string): string | undefined {
	if (host.toLowerCase() === "localhost") return "127.0.0.1";
	if (isIP(host) === 4 && host.startsWith("127.")) return host;
	if (isIP(host) === 6 && new URL(`http://[${host}]`).hostname === "[::1]") return "::1";
	return undefined;
}

export type PermissionMode = "full" | "restricted";

export function resolveBindPermissions(
	host: string,
	requested: string | undefined,
	dangerousAllowNetwork = false,
): { kind: "ok"; host: string; permissions: PermissionMode } | { kind: "error"; message: string } {
	if (requested !== undefined && requested !== "full" && requested !== "restricted") {
		return {
			kind: "error",
			message: `invalid permissions mode ${JSON.stringify(requested)}; use full or restricted`,
		};
	}
	const loopback = loopbackBindHost(host);
	const permissions = requested ?? (loopback === undefined ? "restricted" : "full");
	if (loopback !== undefined) return { kind: "ok", host: loopback, permissions };
	if (permissions === "full" && !dangerousAllowNetwork) {
		return {
			kind: "error",
			message: `refusing full permissions on non-loopback host ${JSON.stringify(host)} without --dangerous-allow-network; use --permissions restricted for public access`,
		};
	}
	return { kind: "ok", host, permissions };
}
