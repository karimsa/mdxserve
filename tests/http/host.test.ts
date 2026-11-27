import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type http from "node:http";
import { hostnameOf, isSameOrigin, isTrustedHost, realtimePeerCheck } from "../../src/http/host.js";

describe("hostnameOf", () => {
	it("strips a port, unwraps IPv6 brackets, and lower-cases", () => {
		expect(hostnameOf("localhost:4040")).toBe("localhost");
		expect(hostnameOf("LOCALHOST")).toBe("localhost");
		expect(hostnameOf("127.0.0.1:4040")).toBe("127.0.0.1");
		expect(hostnameOf("[::1]:4040")).toBe("::1");
		expect(hostnameOf("[::1]")).toBe("::1");
		expect(hostnameOf("::1")).toBe("::1");
		expect(hostnameOf("docs.example.com")).toBe("docs.example.com");
	});
});

describe("isTrustedHost", () => {
	it("accepts loopback names with or without a port", () => {
		for (const host of ["localhost", "localhost:4040", "127.0.0.1:1", "[::1]:4040", "::1"]) {
			expect(isTrustedHost(host, "127.0.0.1")).toBe(true);
		}
	});

	it("accepts the exact address the connection arrived on (the stdio bridge on --host <ip>)", () => {
		expect(isTrustedHost("192.168.1.10:4040", "192.168.1.10")).toBe(true);
		expect(isTrustedHost("192.168.1.10:4040", "::ffff:192.168.1.10")).toBe(true);
		expect(isTrustedHost("[fe80::1]:4040", "fe80::1")).toBe(true);
	});

	it("rejects a rebinding domain, a different address, and a missing header", () => {
		expect(isTrustedHost("attacker.example:4040", "127.0.0.1")).toBe(false);
		expect(isTrustedHost("192.168.1.11:4040", "192.168.1.10")).toBe(false);
		expect(isTrustedHost(undefined, "127.0.0.1")).toBe(false);
		expect(isTrustedHost("", "127.0.0.1")).toBe(false);
	});

	it("property: a DNS name is never trusted, whatever port or local address it comes with", () => {
		const label = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/);
		const dnsName = fc
			.array(label, { minLength: 2, maxLength: 4 })
			.map((labels) => labels.join("."))
			.filter((name) => name !== "localhost");
		const port = fc.integer({ min: 1, max: 65535 });
		const localAddress = fc.constantFrom("127.0.0.1", "::1", "192.168.1.10", "::ffff:10.0.0.5");
		fc.assert(
			fc.property(dnsName, port, localAddress, (name, portNumber, local) => {
				expect(isTrustedHost(`${name}:${portNumber}`, local)).toBe(false);
				expect(isTrustedHost(name, local)).toBe(false);
			}),
			{ numRuns: 200 },
		);
	});

	it("property: the socket's own IPv4 address is trusted with any port", () => {
		const octet = fc.integer({ min: 0, max: 255 });
		const ipv4 = fc.tuple(octet, octet, octet, octet).map((parts) => parts.join("."));
		const port = fc.integer({ min: 1, max: 65535 });
		fc.assert(
			fc.property(ipv4, port, (address, portNumber) => {
				expect(isTrustedHost(`${address}:${portNumber}`, address)).toBe(true);
				expect(isTrustedHost(`${address}:${portNumber}`, `::ffff:${address}`)).toBe(true);
			}),
			{ numRuns: 100 },
		);
	});
});

describe("isSameOrigin", () => {
	it("accepts a missing Origin and one whose host matches Host", () => {
		expect(isSameOrigin(undefined, "localhost:4040")).toBe(true);
		expect(isSameOrigin("http://localhost:4040", "localhost:4040")).toBe(true);
	});

	it("refuses another host or port, a null origin, and an unparsable one", () => {
		expect(isSameOrigin("http://attacker.example", "localhost:4040")).toBe(false);
		expect(isSameOrigin("http://localhost:4041", "localhost:4040")).toBe(false);
		expect(isSameOrigin("null", "localhost:4040")).toBe(false);
		expect(isSameOrigin("not a url", "localhost:4040")).toBe(false);
		expect(isSameOrigin("http://localhost:4040", undefined)).toBe(false);
	});
});

describe("realtimePeerCheck", () => {
	function request(
		headers: Record<string, string>,
		localAddress = "127.0.0.1",
		remoteAddress = "127.0.0.1",
	) {
		return { headers, socket: { localAddress, remoteAddress } } as unknown as http.IncomingMessage;
	}

	/** A tailnet source that knows `hosts`. */
	function source(hosts: string[] = []) {
		const known = new Set(hosts);
		return { current: () => known };
	}

	const full = (req: http.IncomingMessage, tailnet = source()) =>
		Promise.resolve(realtimePeerCheck("full", tailnet)(req));
	const restricted = (req: http.IncomingMessage) =>
		Promise.resolve(realtimePeerCheck("restricted", source())(req));

	it("in full mode, needs both a trusted Host and a same-origin Origin", async () => {
		expect(await full(request({ host: "localhost:4040" }))).toBe(true);
		expect(await full(request({ host: "localhost:4040", origin: "http://localhost:4040" }))).toBe(
			true,
		);
		expect(await full(request({ host: "attacker.example:4040" }))).toBe(false);
		expect(
			await full(
				request({ host: "attacker.example:4040", origin: "http://attacker.example:4040" }),
			),
		).toBe(false);
		expect(await full(request({ host: "localhost:4040", origin: "http://attacker.example" }))).toBe(
			false,
		);
		expect(await full(request({}))).toBe(false);
	});

	it("in full mode, accepts the LAN address the connection arrived on", async () => {
		expect(await full(request({ host: "192.168.1.10:4040" }, "192.168.1.10", "192.168.1.20"))).toBe(
			true,
		);
		expect(await full(request({ host: "192.168.1.11:4040" }, "192.168.1.10"))).toBe(false);
	});

	it("in restricted mode, accepts a server name and needs only a same-origin Origin", async () => {
		expect(
			await restricted(request({ host: "mybox.local:4040", origin: "http://mybox.local:4040" })),
		).toBe(true);
		expect(
			await restricted(request({ host: "docs.example.com", origin: "https://docs.example.com" })),
		).toBe(true);
		expect(await restricted(request({ host: "docs.example.com" }))).toBe(true);
		expect(
			await restricted(request({ host: "docs.example.com", origin: "https://attacker.example" })),
		).toBe(false);
		expect(await restricted(request({ host: "docs.example.com", origin: "null" }))).toBe(false);
	});

	const tailnetName = "box.tail1234.ts.net";

	it("S1: in full mode, accepts a tailnet Host from loopback, on 443 and on another port", async () => {
		const tailnet = source([tailnetName, `${tailnetName}:4040`]);
		expect(
			await full(request({ host: tailnetName, origin: `https://${tailnetName}` }), tailnet),
		).toBe(true);
		expect(
			await full(
				request({ host: `${tailnetName}:4040`, origin: `https://${tailnetName}:4040` }),
				tailnet,
			),
		).toBe(true);
		expect(await full(request({ host: tailnetName.toUpperCase() }), tailnet)).toBe(true);
	});

	it("S1: still accepts when the proxy rewrites Host to its loopback target", async () => {
		expect(await full(request({ host: "127.0.0.1:4040" }), source([tailnetName]))).toBe(true);
	});

	it("S2: refuses a tailnet Host from a remote address, on another port, or cross-origin", async () => {
		const tailnet = source([tailnetName]);
		expect(await full(request({ host: tailnetName }, "100.64.0.1", "100.64.0.9"), tailnet)).toBe(
			false,
		);
		expect(await full(request({ host: `${tailnetName}:8443` }), tailnet)).toBe(false);
		expect(
			await full(request({ host: tailnetName, origin: "https://attacker.example" }), tailnet),
		).toBe(false);
		expect(await full(request({ host: "other.tail1234.ts.net" }), tailnet)).toBe(false);
	});

	it("without a tailnet source (--no-tailscale), refuses a tailnet Host", async () => {
		expect(await realtimePeerCheck("full", undefined)(request({ host: tailnetName }))).toBe(false);
	});

	it("property: a DNS name passes in full mode only from loopback and in the tailnet set, and never gets same-machine trust", async () => {
		const label = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/);
		const dnsName = fc
			.array(label, { minLength: 2, maxLength: 4 })
			.map((labels) => labels.join("."))
			.filter((name) => name !== "localhost");
		await fc.assert(
			fc.asyncProperty(dnsName, fc.boolean(), fc.boolean(), async (name, inSet, fromLoopback) => {
				const tailnet = source(inSet ? [name] : []);
				const remote = fromLoopback ? "127.0.0.1" : "100.64.0.9";
				const local = fromLoopback ? "127.0.0.1" : "100.64.0.1";
				expect(await full(request({ host: name }, local, remote), tailnet)).toBe(
					inSet && fromLoopback,
				);
				expect(isTrustedHost(name, local)).toBe(false);
			}),
			{ numRuns: 200 },
		);
	});
});

describe("isTrustedHost and tailnet names (S3)", () => {
	it("is false for a tailnet Host on loopback, so HTTP gives it no same-machine privileges", () => {
		expect(isTrustedHost("box.tail1234.ts.net", "127.0.0.1")).toBe(false);
		expect(isTrustedHost("box.tail1234.ts.net:4040", "127.0.0.1")).toBe(false);
	});
});
