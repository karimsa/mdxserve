import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { matchingAddresses, parseServeStatus } from "../../src/tailscale/serve-config.js";

// A small port set, so generated entries often do point at the server.
const port = fc.constantFrom(80, 443, 4040, 8443);
const hostname = fc.constantFrom("box.tail1.ts.net", "other.tail1.ts.net");
const mountPath = fc.constantFrom("/", "/", "/docs", "/a/b");
const target = fc.constantFrom("127.0.0.1", "localhost", "[::1]", "192.168.1.10");
const scheme = fc.constantFrom("http", "http", "https", "https+insecure");

const handler = fc.record({
	path: mountPath,
	scheme,
	target,
	port,
	proxyPath: fc.constantFrom("", "", "/docs"),
});
const site = fc.record({
	hostname,
	port,
	handlers: fc.array(handler, { maxLength: 3 }),
	funnel: fc.boolean(),
	https: fc.boolean(),
	foreground: fc.boolean(),
});

interface GeneratedSite {
	hostname: string;
	port: number;
	handlers: { path: string; scheme: string; target: string; port: number; proxyPath: string }[];
	funnel: boolean;
	https: boolean;
	foreground: boolean;
}

interface Config {
	TCP: Record<string, { HTTPS?: boolean; HTTP?: boolean }>;
	Web: Record<string, { Handlers: Record<string, { Proxy: string }> }>;
	AllowFunnel: Record<string, boolean>;
}

/** Builds `tailscale serve status --json` output, with some sites in a foreground session. */
function serveStatus(sites: GeneratedSite[]) {
	const background: Config = { TCP: {}, Web: {}, AllowFunnel: {} };
	const foreground: Config = { TCP: {}, Web: {}, AllowFunnel: {} };
	for (const generated of sites) {
		const config = generated.foreground ? foreground : background;
		const key = `${generated.hostname}:${generated.port}`;
		config.TCP[String(generated.port)] = generated.https ? { HTTPS: true } : { HTTP: true };
		config.Web[key] ??= { Handlers: {} };
		for (const entry of generated.handlers) {
			config.Web[key].Handlers[entry.path] = {
				Proxy: `${entry.scheme}://${entry.target}:${entry.port}${entry.proxyPath}`,
			};
		}
		if (generated.funnel) config.AllowFunnel[key] = true;
	}
	return { ...background, Foreground: { session: foreground } };
}

describe("serve-config properties", () => {
	it("an address is returned only for an HTTPS `/` entry proxying over http to the server's port", () => {
		fc.assert(
			fc.property(
				fc.array(site, { maxLength: 4 }),
				port,
				fc.constantFrom("127.0.0.1", "0.0.0.0", "192.168.1.10"),
				(sites, serverPort, boundHost) => {
					const config = parseServeStatus(serveStatus(sites));
					expect(config).toBeDefined();
					const entries = config?.entries ?? [];
					const addresses = matchingAddresses(entries, { port: serverPort, boundHost });
					for (const address of addresses) {
						const backing = entries.filter((entry) => {
							const host = entry.port === 443 ? entry.hostname : `${entry.hostname}:${entry.port}`;
							return entry.https && host === address.host;
						});
						expect(
							backing.some(
								(entry) =>
									entry.path === "/" &&
									entry.proxy?.protocol === "http" &&
									entry.proxy.port === serverPort &&
									entry.proxy.path === "/",
							),
						).toBe(true);
						expect(address.url).toBe(`https://${address.host}/`);
					}
				},
			),
			{ numRuns: 500 },
		);
	});

	it("parsing never throws on arbitrary JSON", () => {
		fc.assert(
			fc.property(fc.jsonValue(), (value) => {
				expect(() => parseServeStatus(value)).not.toThrow();
			}),
			{ numRuns: 300 },
		);
	});
});
