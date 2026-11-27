import { z } from "zod";
import { loopbackBindHost } from "../servers/bind-host.js";

/** One `Web` handler of `tailscale serve status --json`. */
interface ServeEntry {
	/** `karims-macbook-air.tailda6846.ts.net`, lower-cased. */
	hostname: string;
	/** The HTTPS port Tailscale listens on, for example 443 or 4040. */
	port: number;
	/** The mount path of the handler, for example `/`. */
	path: string;
	/** The handler's `Proxy` target, when it is one. */
	proxy: { protocol: "http" | "https"; hostname: string; port: number } | null;
	/** Whether `AllowFunnel["<hostname>:<port>"]` is true. */
	funnel: boolean;
}

interface ServeConfig {
	entries: ServeEntry[];
	/** Every port the config listens on, web or raw TCP. */
	usedPorts: number[];
}

/** A tailnet address that proxies `/` to this server. */
export interface TailnetAddress {
	/** The `Host` header a browser sends: `hostname` for 443, otherwise `hostname:port`. */
	host: string;
	/** `https://<host>/` */
	url: string;
	funnel: boolean;
}

/** The server a serve entry has to reach. `boundHost` is the address it listens on. */
export interface ServerEndpoint {
	port: number;
	boundHost: string;
}

// Only the keys read here are described; Tailscale adds others between
// versions, and they pass through.
const serveStatusSchema = z.object({
	TCP: z.record(z.string(), z.unknown()).optional(),
	Web: z
		.record(
			z.string(),
			z.object({
				Handlers: z
					.record(z.string(), z.object({ Proxy: z.string().optional() }).loose())
					.optional(),
			}),
		)
		.optional(),
	AllowFunnel: z.record(z.string(), z.boolean()).optional(),
});

const statusSchema = z.object({
	BackendState: z.string(),
	Self: z.object({ DNSName: z.string().optional() }).loose().optional(),
});

function parsePort(text: string): number | undefined {
	if (!/^\d{1,5}$/.test(text)) return undefined;
	const port = Number(text);
	return port >= 1 && port <= 65535 ? port : undefined;
}

/** `host:port` as Tailscale writes a `Web` key. */
function splitHostPort(key: string): { hostname: string; port: number } | undefined {
	const colon = key.lastIndexOf(":");
	if (colon <= 0) return undefined;
	const port = parsePort(key.slice(colon + 1));
	if (port === undefined) return undefined;
	return { hostname: key.slice(0, colon).toLowerCase(), port };
}

function parseProxy(target: string | undefined): ServeEntry["proxy"] {
	if (target === undefined) return null;
	let url: URL;
	try {
		url = new URL(target);
	} catch {
		return null;
	}
	const protocol =
		url.protocol === "http:"
			? "http"
			: url.protocol === "https:" || url.protocol === "https+insecure:"
				? "https"
				: undefined;
	if (protocol === undefined || url.hostname === "") return null;
	const port = url.port === "" ? (protocol === "http" ? 80 : 443) : parsePort(url.port);
	if (port === undefined) return null;
	const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
	return { protocol, hostname, port };
}

/**
 * Read `tailscale serve status --json`. Returns undefined when the output is
 * not the shape this version of Tailscale writes, so the caller can report it
 * instead of guessing.
 */
export function parseServeStatus(json: unknown): ServeConfig | undefined {
	const parsed = serveStatusSchema.safeParse(json);
	if (!parsed.success) return undefined;
	const { TCP: tcp = {}, Web: web = {}, AllowFunnel: allowFunnel = {} } = parsed.data;
	const entries: ServeEntry[] = [];
	const usedPorts = new Set<number>();
	for (const key of Object.keys(tcp)) {
		const port = parsePort(key);
		if (port !== undefined) usedPorts.add(port);
	}
	for (const [key, site] of Object.entries(web)) {
		const address = splitHostPort(key);
		if (address === undefined) continue;
		usedPorts.add(address.port);
		for (const [mountPath, handler] of Object.entries(site.Handlers ?? {})) {
			entries.push({
				hostname: address.hostname,
				port: address.port,
				path: mountPath,
				proxy: parseProxy(handler.Proxy),
				funnel: allowFunnel[key] === true,
			});
		}
	}
	return { entries, usedPorts: [...usedPorts].sort((left, right) => left - right) };
}

/** `BackendState` and `Self.DNSName` (trailing dot removed) from `tailscale status --json`. */
export function parseStatus(json: unknown): { state: string; dnsName: string } | undefined {
	const parsed = statusSchema.safeParse(json);
	if (!parsed.success) return undefined;
	const dnsName = (parsed.data.Self?.DNSName ?? "").replace(/\.$/, "").toLowerCase();
	return { state: parsed.data.BackendState, dnsName };
}

const LOOPBACK_TARGETS = new Set(["127.0.0.1", "localhost", "::1"]);
const WILDCARD_HOSTS = new Set(["0.0.0.0", "::"]);

/**
 * Whether an entry's proxy target is this server, whatever path it is
 * mounted at. A loopback target only reaches a server that listens on
 * loopback: one bound to loopback, or to every interface.
 */
function targetsServer(entry: ServeEntry, server: ServerEndpoint): boolean {
	const proxy = entry.proxy;
	if (proxy === null || proxy.protocol !== "http" || proxy.port !== server.port) return false;
	const bound = server.boundHost.toLowerCase();
	if (proxy.hostname === bound) return true;
	const listensOnLoopback = WILDCARD_HOSTS.has(bound) || loopbackBindHost(bound) !== undefined;
	return listensOnLoopback && LOOPBACK_TARGETS.has(proxy.hostname);
}

/** The addresses whose `/` proxies to this server. */
export function matchingAddresses(entries: ServeEntry[], server: ServerEndpoint): TailnetAddress[] {
	const addresses = new Map<string, TailnetAddress>();
	for (const entry of entries) {
		if (entry.path !== "/" || !targetsServer(entry, server)) continue;
		const host = entry.port === 443 ? entry.hostname : `${entry.hostname}:${entry.port}`;
		addresses.set(host, { host, url: `https://${host}/`, funnel: entry.funnel });
	}
	return [...addresses.values()];
}

/**
 * The `https://<address><path>` of each entry that proxies to this server
 * under a path other than `/`. The client asks for absolute `/__mdxserve/...`
 * URLs, so such a mount cannot serve it.
 */
export function unsupportedPaths(entries: ServeEntry[], server: ServerEndpoint): string[] {
	return entries
		.filter((entry) => entry.path !== "/" && targetsServer(entry, server))
		.map((entry) => {
			const host = entry.port === 443 ? entry.hostname : `${entry.hostname}:${entry.port}`;
			return `https://${host}${entry.path}`;
		});
}
