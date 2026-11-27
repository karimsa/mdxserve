import { describe, expect, it } from "vitest";
import {
	matchingAddresses,
	parseServeStatus,
	parseStatus,
	unsupportedPaths,
} from "../../src/tailscale/serve-config.js";

const NAME = "karims-macbook-air.tailda6846.ts.net";

/** The shape Tailscale 1.72.0 prints, with three entries and no `AllowFunnel`. */
const REAL_SHAPE = {
	TCP: { "10000": { HTTPS: true }, "443": { HTTPS: true }, "8443": { HTTPS: true } },
	Web: {
		[`${NAME}:10000`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3001" } } },
		[`${NAME}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:8080" } } },
		[`${NAME}:8443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:5173" } } },
	},
};

const loopbackServer = (port: number) => ({ port, boundHost: "127.0.0.1" });

describe("parseServeStatus", () => {
	it("reads every web handler with its port, path, proxy and funnel flag", () => {
		const config = parseServeStatus(REAL_SHAPE);
		expect(config?.usedPorts).toEqual([443, 8443, 10000]);
		expect(config?.entries).toContainEqual({
			hostname: NAME,
			port: 443,
			path: "/",
			proxy: { protocol: "http", hostname: "127.0.0.1", port: 8080 },
			funnel: false,
		});
		expect(config?.entries).toHaveLength(3);
	});

	it("reads AllowFunnel per host and port", () => {
		const config = parseServeStatus({
			...REAL_SHAPE,
			AllowFunnel: { [`${NAME}:443`]: true },
		});
		const funnelled = config?.entries.filter((entry) => entry.funnel).map((entry) => entry.port);
		expect(funnelled).toEqual([443]);
	});

	it("reads an empty config as no entries", () => {
		expect(parseServeStatus({})).toEqual({ entries: [], usedPorts: [] });
	});

	it("reads several handlers, a sub-path, a text handler and an IPv6 target", () => {
		const config = parseServeStatus({
			Web: {
				[`${NAME}:4040`]: {
					Handlers: {
						"/": { Proxy: "http://[::1]:4040" },
						"/docs": { Proxy: "http://localhost:4040" },
						"/hello": { Text: "hi" },
						"/insecure": { Proxy: "https+insecure://localhost:8443" },
					},
				},
			},
		});
		expect(config?.entries.map((entry) => [entry.path, entry.proxy])).toEqual([
			["/", { protocol: "http", hostname: "::1", port: 4040 }],
			["/docs", { protocol: "http", hostname: "localhost", port: 4040 }],
			["/hello", null],
			["/insecure", { protocol: "https", hostname: "localhost", port: 8443 }],
		]);
	});

	it("rejects output that is not a serve config", () => {
		for (const garbage of [null, "text", 42, [], { Web: "nope" }, { Web: { key: 1 } }]) {
			expect(parseServeStatus(garbage)).toBeUndefined();
		}
	});

	it("skips a web key without a port", () => {
		expect(
			parseServeStatus({ Web: { [NAME]: { Handlers: { "/": { Proxy: "http://127.0.0.1:1" } } } } })
				?.entries,
		).toEqual([]);
	});
});

describe("parseStatus", () => {
	it("reads the backend state and strips the trailing dot of the DNS name", () => {
		expect(parseStatus({ BackendState: "Running", Self: { DNSName: `${NAME}.` } })).toEqual({
			state: "Running",
			dnsName: NAME,
		});
		expect(parseStatus({ BackendState: "NeedsLogin" })).toEqual({
			state: "NeedsLogin",
			dnsName: "",
		});
		expect(parseStatus({ nothing: true })).toBeUndefined();
	});
});

describe("matchingAddresses", () => {
	const entries = parseServeStatus(REAL_SHAPE)?.entries ?? [];

	it("matches none of the real entries to a server on 4040", () => {
		expect(matchingAddresses(entries, loopbackServer(4040))).toEqual([]);
	});

	it("names a 443 entry by its bare host and another port with the port", () => {
		expect(matchingAddresses(entries, loopbackServer(8080))).toEqual([
			{ host: NAME, url: `https://${NAME}/`, funnel: false },
		]);
		expect(matchingAddresses(entries, loopbackServer(5173))).toEqual([
			{ host: `${NAME}:8443`, url: `https://${NAME}:8443/`, funnel: false },
		]);
	});

	it("matches a loopback target only when the server listens on loopback", () => {
		const config = parseServeStatus({
			Web: { [`${NAME}:443`]: { Handlers: { "/": { Proxy: "http://localhost:4040" } } } },
		});
		const local = config?.entries ?? [];
		expect(matchingAddresses(local, { port: 4040, boundHost: "0.0.0.0" })).toHaveLength(1);
		expect(matchingAddresses(local, { port: 4040, boundHost: "::" })).toHaveLength(1);
		expect(matchingAddresses(local, { port: 4040, boundHost: "::1" })).toHaveLength(1);
		expect(matchingAddresses(local, { port: 4040, boundHost: "192.168.1.10" })).toEqual([]);
	});

	it("matches a target that is the bound address", () => {
		const config = parseServeStatus({
			Web: { [`${NAME}:443`]: { Handlers: { "/": { Proxy: "http://192.168.1.10:4040" } } } },
		});
		expect(
			matchingAddresses(config?.entries ?? [], { port: 4040, boundHost: "192.168.1.10" }),
		).toHaveLength(1);
		expect(matchingAddresses(config?.entries ?? [], loopbackServer(4040))).toEqual([]);
	});

	it("ignores an https target, a sub-path and a non-proxy handler", () => {
		const config = parseServeStatus({
			Web: {
				[`${NAME}:443`]: { Handlers: { "/": { Proxy: "https+insecure://localhost:4040" } } },
				[`${NAME}:8443`]: { Handlers: { "/docs": { Proxy: "http://127.0.0.1:4040" } } },
				[`${NAME}:10000`]: { Handlers: { "/": { Path: "/tmp" } } },
			},
		});
		expect(matchingAddresses(config?.entries ?? [], loopbackServer(4040))).toEqual([]);
	});
});

describe("unsupportedPaths", () => {
	it("lists the sub-path mounts that proxy to this server", () => {
		const config = parseServeStatus({
			Web: {
				[`${NAME}:443`]: {
					Handlers: {
						"/docs": { Proxy: "http://127.0.0.1:4040" },
						"/other": { Proxy: "http://127.0.0.1:9999" },
					},
				},
			},
		});
		expect(unsupportedPaths(config?.entries ?? [], loopbackServer(4040))).toEqual([
			`https://${NAME}/docs`,
		]);
	});
});
