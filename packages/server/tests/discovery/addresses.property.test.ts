import * as fc from "fast-check";
import { expect, it } from "vitest";
import {
	reachableOrigins,
	shareOrigin,
	type NetworkInterfaces,
} from "../../src/discovery/addresses.js";
import { loopbackBindHost } from "../../src/servers/bind-host.js";

const octet = fc.integer({ min: 0, max: 255 });
const ipv4Arb = fc.tuple(octet, octet, octet, octet).map((parts) => parts.join("."));

const interfacesArb: fc.Arbitrary<NetworkInterfaces> = fc
	.array(fc.record({ address: ipv4Arb, internal: fc.boolean() }), { maxLength: 6 })
	.map((entries) => ({
		en0: entries.map(({ address, internal }) => ({
			address,
			netmask: "255.255.255.0",
			family: "IPv4" as const,
			mac: "00:00:00:00:00:00",
			internal,
			cidr: `${address}/24`,
		})),
	}));

const boundHostArb = fc.oneof(
	fc.constantFrom("127.0.0.1", "::1", "localhost", "0.0.0.0", "::"),
	ipv4Arb,
);

const tailnetUrlsArb = fc.array(
	fc.oneof(
		fc.domain().map((domain) => `https://${domain}`),
		fc.domain().map((domain) => `http://${domain}`),
		fc.string(),
	),
	{ maxLength: 4 },
);

function isLoopbackOrigin(url: string): boolean {
	const hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
	return loopbackBindHost(hostname) !== undefined;
}

function isTailscaleOrLinkLocal(url: string): boolean {
	const [first = 0, second = 0] = new URL(url).hostname.split(".").map(Number);
	return (first === 100 && second >= 64 && second <= 127) || (first === 169 && second === 254);
}

it("property: no origin is loopback, a tailnet one is https, and a wildcard LAN one is never Tailscale or link-local", () => {
	fc.assert(
		fc.property(
			boundHostArb,
			fc.integer({ min: 1, max: 65535 }),
			tailnetUrlsArb,
			interfacesArb,
			(boundHost, port, tailnetUrls, interfaces) => {
				const origins = reachableOrigins({ boundHost, port, tailnetUrls, interfaces });
				for (const origin of origins) {
					expect(isLoopbackOrigin(origin.url)).toBe(false);
					if (origin.via === "tailnet") expect(new URL(origin.url).protocol).toBe("https:");
					if (origin.via === "lan" && (boundHost === "0.0.0.0" || boundHost === "::")) {
						expect(isTailscaleOrLinkLocal(origin.url)).toBe(false);
					}
				}
				expect(origins.filter((origin) => origin.via === "lan").length).toBeLessThanOrEqual(1);
				if (loopbackBindHost(boundHost) !== undefined) {
					expect(origins.every((origin) => origin.via === "tailnet")).toBe(true);
				}
			},
		),
	);
});

it("property: the shared origin is one of the reachable ones, and a tailnet one unless the LAN is preferred", () => {
	const originArb = fc.oneof(
		fc.domain().map((domain) => ({ url: `https://${domain}`, via: "tailnet" as const })),
		ipv4Arb.map((address) => ({ url: `http://${address}:4040`, via: "lan" as const })),
	);
	fc.assert(
		fc.property(fc.array(originArb, { maxLength: 5 }), fc.boolean(), (origins, preferLan) => {
			const result = shareOrigin(origins, { preferLan });
			const hasLan = origins.some((origin) => origin.via === "lan");
			const hasTailnet = origins.some((origin) => origin.via === "tailnet");
			if (result.kind === "ok") {
				expect(origins).toContainEqual(result.origin);
				expect(result.origin.via).toBe(preferLan || !hasTailnet ? "lan" : "tailnet");
			} else if (result.kind === "no-lan") {
				expect(preferLan && !hasLan).toBe(true);
			} else {
				expect(origins).toEqual([]);
			}
		}),
	);
});
