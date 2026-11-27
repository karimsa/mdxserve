import { loopbackBindHost, type PermissionMode } from "../servers/bind-host.js";
import type { TailscaleDetection } from "./service.js";

export interface ReportContext {
	port: number;
	/** The address the server listens on, after `localhost` was resolved. */
	boundHost: string;
	permissions: PermissionMode;
	/** `MDXSERVE_DEBUG` is set: a failed detection says why. */
	debug: boolean;
}

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::"]);

/** A path is typed as is; one with a space or a quote is single-quoted for a POSIX shell. */
function shellWord(word: string): string {
	return /^[\w./:@=+-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

/** `https://<name>` for 443, `https://<name>:<port>` otherwise, like the other printed URLs. */
function httpsUrl(dnsName: string, port: number): string {
	return port === 443 ? `https://${dnsName}` : `https://${dnsName}:${port}`;
}

/** The proxy target `tailscale serve` should forward to. It only proxies to `http://`. */
function proxyTarget(context: ReportContext): string {
	const host = context.boundHost;
	if (WILDCARD_HOSTS.has(host)) return `http://127.0.0.1:${context.port}`;
	return host.includes(":") ? `http://[${host}]:${context.port}` : `http://${host}:${context.port}`;
}

/**
 * The lines startup prints about Tailscale, all for stderr. Empty when the
 * CLI is missing, Tailscale is not running, or detection failed without
 * `MDXSERVE_DEBUG`.
 */
export function tailscaleReport(detection: TailscaleDetection, context: ReportContext): string[] {
	if (detection.kind === "not-found" || detection.kind === "not-running") return [];
	if (detection.kind === "failed") {
		return context.debug ? [`mdxserve: Tailscale detection failed: ${detection.message}`] : [];
	}
	const cli = shellWord(detection.cli);
	const lines: string[] = [];
	for (const address of detection.addresses) {
		const url = address.url.replace(/\/$/, "");
		const label = address.funnel ? "public through Tailscale Funnel" : "tailnet, HTTPS";
		lines.push(`  - Tailnet:  ${url} (${label})`);
	}
	if (context.permissions === "full") {
		for (const address of detection.addresses.filter((candidate) => candidate.funnel)) {
			const colon = address.host.lastIndexOf(":");
			const httpsPort = colon === -1 ? "443" : address.host.slice(colon + 1);
			lines.push(
				`mdxserve: warning: ${address.url.replace(/\/$/, "")} is public through Tailscale Funnel and this server has full permissions.`,
				"  Anyone on the internet can read and edit the mounted documents. Either:",
				`    turn Funnel off:  ${cli} funnel --https=${httpsPort} off`,
				"    or restart the server with --permissions restricted",
			);
		}
	}
	for (const mounted of detection.unsupportedPaths) {
		lines.push(
			`mdxserve: ${mounted} proxies to this server with a path, which does not work: mount it at / with a target that has no path, such as ${proxyTarget(context)}.`,
		);
	}
	if (detection.addresses.length === 0) {
		const httpsPort = detection.suggestedHttpsPort;
		lines.push(
			"Tailscale is running. To open this server from your other devices over HTTPS:",
			`  ${cli} serve --bg --https=${httpsPort} ${proxyTarget(context)}`,
		);
		if (detection.dnsName !== "") {
			lines.push(`It will be at ${httpsUrl(detection.dnsName, httpsPort)} (tailnet only).`);
		}
		if (context.permissions === "full") {
			lines.push(
				"Every device on your tailnet will be able to read and edit the mounted documents.",
			);
			if (loopbackBindHost(context.boundHost) === undefined) {
				lines.push(
					"The tailnet address needs neither --host nor --dangerous-allow-network: restart without them to keep the server off your local network.",
				);
			}
		}
	}
	return lines;
}
