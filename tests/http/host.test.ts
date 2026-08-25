import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { hostnameOf, isTrustedHost } from "../../src/http/host.js";

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
