import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { matchingAddresses, parseServeStatus } from "../../src/tailscale/serve-config.js";

const port = fc.integer({ min: 1, max: 65535 });
const hostname = fc.constantFrom("box.tail1.ts.net", "other.tail1.ts.net");
const mountPath = fc.constantFrom("/", "/", "/docs", "/a/b");
const target = fc.constantFrom("127.0.0.1", "localhost", "[::1]", "192.168.1.10");
const scheme = fc.constantFrom("http", "http", "https", "https+insecure");

const handler = fc.record({ path: mountPath, scheme, target, port });
const site = fc.record({
	hostname,
	port,
	handlers: fc.array(handler, { maxLength: 3 }),
	funnel: fc.boolean(),
});

/** Builds `tailscale serve status --json` output from generated sites. */
interface GeneratedSite {
	hostname: string;
	port: number;
	handlers: { path: string; scheme: string; target: string; port: number }[];
	funnel: boolean;
}

function serveStatus(sites: GeneratedSite[]) {
	const web: Record<string, { Handlers: Record<string, { Proxy: string }> }> = {};
	const allowFunnel: Record<string, boolean> = {};
	for (const generated of sites) {
		const key = `${generated.hostname}:${generated.port}`;
		web[key] ??= { Handlers: {} };
		for (const entry of generated.handlers) {
			web[key].Handlers[entry.path] = {
				Proxy: `${entry.scheme}://${entry.target}:${entry.port}`,
			};
		}
		if (generated.funnel) allowFunnel[key] = true;
	}
	return { Web: web, AllowFunnel: allowFunnel };
}

describe("serve-config properties", () => {
	it("an address is returned only for a `/` entry proxying over http to the server's port", () => {
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
							return host === address.host;
						});
						expect(
							backing.some(
								(entry) =>
									entry.path === "/" &&
									entry.proxy?.protocol === "http" &&
									entry.proxy.port === serverPort,
							),
						).toBe(true);
						expect(address.url).toBe(`https://${address.host}/`);
					}
				},
			),
			{ numRuns: 300 },
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
