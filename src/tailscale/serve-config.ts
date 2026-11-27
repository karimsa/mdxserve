import { isIP } from "node:net";
import { z } from "zod";
import { loopbackBindHost } from "../servers/bind-host.js";

/** One `Web` handler of `tailscale serve status --json`. */
interface ServeEntry {
	/** `karims-macbook-air.tailda6846.ts.net`, lower-cased. */
	hostname: string;
	/** The port Tailscale listens on, for example 443 or 4040. */
	port: number;
	/** False for a plain HTTP listener (`tailscale serve --http`). */
	https: boolean;
	/** The mount path of the handler, for example `/`. */
	path: string;
	/** The handler's `Proxy` target, when it is one. */
	proxy: { protocol: "http" | "https"; hostname: string; port: number; path: string } | null;
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
const configSchema = z.object({
	TCP: z
		.record(
			z.string(),
			z.object({ HTTP: z.boolean().optional(), HTTPS: z.boolean().optional() }).loose(),
		)
		.optional(),
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

const serveStatusSchema = configSchema.extend({
	Foreground: z.record(z.string(), configSchema).optional(),
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
	// Tailscale prepends a target's path to every request it forwards.
	return { protocol, hostname, port, path: url.pathname || "/" };
}

/**
 * Read `tailscale serve status --json`. Returns undefined when the output is
 * not the shape this version of Tailscale writes, so the caller can report it
 * instead of guessing.
 */
export function parseServeStatus(json: unknown): ServeConfig | undefined {
	// Tailscale prints `null` when serve has never been configured.
	const parsed = serveStatusSchema.safeParse(json === null ? {} : json);
	if (!parsed.success) return undefined;
	const entries: ServeEntry[] = [];
	const usedPorts = new Set<number>();
	// A `tailscale serve` run without `--bg` keeps its config under
	// `Foreground`, one per session, in the same shape as the top level.
	const configs = [parsed.data, ...Object.values(parsed.data.Foreground ?? {})];
	for (const { TCP: tcp = {}, Web: web = {}, AllowFunnel: allowFunnel = {} } of configs) {
		for (const key of Object.keys(tcp)) {
			const port = parsePort(key);
			if (port !== undefined) usedPorts.add(port);
		}
		for (const [key, site] of Object.entries(web)) {
			const address = splitHostPort(key);
			if (address === undefined) continue;
			usedPorts.add(address.port);
			const listener = tcp[String(address.port)];
			// `--http` listeners have web handlers too; anything not marked
			// plain HTTP is the HTTPS default.
			const https = !(listener?.HTTP === true && listener.HTTPS !== true);
			for (const [mountPath, handler] of Object.entries(site.Handlers ?? {})) {
				entries.push({
					hostname: address.hostname,
					port: address.port,
					https,
					path: mountPath,
					proxy: parseProxy(handler.Proxy),
					funnel: allowFunnel[key] === true,
				});
			}
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
 * Whether a connection to `target` reaches a listener bound to `bound`.
 * A concrete address only answers on itself; `localhost` is dialled on both
 * families, so it reaches either loopback. `0.0.0.0` answers every IPv4
 * address, and `::` (dual-stack) every address.
 */
function reaches(target: string, bound: string): boolean {
	if (target === bound) return true;
	if (target === "localhost") {
		return WILDCARD_HOSTS.has(bound) || bound === "127.0.0.1" || bound === "::1";
	}
	if (bound === "::") return LOOPBACK_TARGETS.has(target) || isIPv4Loopback(target);
	if (bound === "0.0.0.0") return isIPv4Loopback(target);
	return false;
}

function isIPv4Loopback(address: string): boolean {
	return isIP(address) === 4 && loopbackBindHost(address) !== undefined;
}

/** Whether an entry's proxy target is this server, whatever path it is mounted at. */
function targetsServer(entry: ServeEntry, server: ServerEndpoint): boolean {
	const proxy = entry.proxy;
	if (proxy === null || proxy.protocol !== "http" || proxy.port !== server.port) return false;
	return reaches(proxy.hostname, server.boundHost.toLowerCase());
}

/** The `Host` a browser sends for an entry: the default port for its scheme is left out. */
function hostOf(entry: ServeEntry): string {
	const defaultPort = entry.https ? 443 : 80;
	return entry.port === defaultPort ? entry.hostname : `${entry.hostname}:${entry.port}`;
}

/**
 * Whether an entry maps paths one to one: mounted at `/`, forwarding to the
 * target's `/`. The client asks for absolute `/__mdxserve/...` URLs, so any
 * other mount or target path cannot serve it.
 */
function mapsRoot(entry: ServeEntry): boolean {
	return entry.path === "/" && entry.proxy?.path === "/";
}

/** The HTTPS addresses whose `/` proxies to this server's `/`. A plain HTTP listener is not one. */
export function matchingAddresses(entries: ServeEntry[], server: ServerEndpoint): TailnetAddress[] {
	const addresses = new Map<string, TailnetAddress>();
	for (const entry of entries) {
		if (!entry.https || !mapsRoot(entry) || !targetsServer(entry, server)) continue;
		const host = hostOf(entry);
		addresses.set(host, { host, url: `https://${host}/`, funnel: entry.funnel });
	}
	return [...addresses.values()];
}

/**
 * The URL of each entry that proxies to this server but is mounted under a
 * sub-path, or forwards to a path on the server, so it cannot serve it.
 */
export function unsupportedPaths(entries: ServeEntry[], server: ServerEndpoint): string[] {
	return entries
		.filter((entry) => !mapsRoot(entry) && targetsServer(entry, server))
		.map((entry) => `${entry.https ? "https" : "http"}://${hostOf(entry)}${entry.path}`);
}
