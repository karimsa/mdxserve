import { describe, expect, it } from "vitest";
import {
	lanAddress,
	reachableOrigins,
	shareOrigin,
	type NetworkInterfaces,
} from "../../src/discovery/addresses.js";

function ipv4(address: string, internal = false) {
	return {
		address,
		netmask: "255.255.255.0",
		family: "IPv4" as const,
		mac: "00:00:00:00:00:00",
		internal,
		cidr: `${address}/24`,
	};
}

function ipv6(address: string) {
	return {
		address,
		netmask: "ffff:ffff:ffff:ffff::",
		family: "IPv6" as const,
		mac: "00:00:00:00:00:00",
		internal: false,
		cidr: `${address}/64`,
		scopeid: 0,
	};
}

/** A Mac on Wi-Fi with Tailscale up: loopback, a link-local leftover, the tailnet, then Wi-Fi. */
const LAPTOP: NetworkInterfaces = {
	lo0: [ipv4("127.0.0.1", true)],
	bridge0: [ipv4("169.254.12.3")],
	utun4: [ipv4("100.101.102.103"), ipv6("fd7a:115c:a1e0::1")],
	en0: [ipv6("fe80::1"), ipv4("192.168.1.23")],
};

describe("lanAddress", () => {
	it.each(["127.0.0.1", "127.0.0.2", "::1", "localhost"])("is undefined on loopback %s", (host) => {
		expect(lanAddress(host, LAPTOP)).toBeUndefined();
	});

	it("is the bind address when it is concrete", () => {
		expect(lanAddress("10.0.0.5", LAPTOP)).toBe("10.0.0.5");
		expect(lanAddress("2001:db8::1", LAPTOP)).toBe("2001:db8::1");
	});

	it.each(["0.0.0.0", "::"])(
		"skips internal, Tailscale and link-local addresses on a wildcard %s bind",
		(host) => {
			expect(lanAddress(host, LAPTOP)).toBe("192.168.1.23");
		},
	);

	it("is undefined on a wildcard bind with only loopback and the tailnet", () => {
		expect(lanAddress("0.0.0.0", { lo0: LAPTOP.lo0, utun4: LAPTOP.utun4 })).toBeUndefined();
	});

	it("keeps 100.x addresses outside the Tailscale range", () => {
		expect(lanAddress("0.0.0.0", { en0: [ipv4("100.63.0.1")] })).toBe("100.63.0.1");
		expect(lanAddress("0.0.0.0", { en0: [ipv4("100.128.0.1")] })).toBe("100.128.0.1");
	});
});

describe("reachableOrigins", () => {
	it("lists tailnet origins first, then the LAN address", () => {
		expect(
			reachableOrigins({
				boundHost: "0.0.0.0",
				port: 4040,
				tailnetUrls: ["https://box.tail1234.ts.net:4040", "https://box.tail1234.ts.net"],
				interfaces: LAPTOP,
			}),
		).toEqual([
			{ url: "https://box.tail1234.ts.net:4040", via: "tailnet" },
			{ url: "https://box.tail1234.ts.net", via: "tailnet" },
			{ url: "http://192.168.1.23:4040", via: "lan" },
		]);
	});

	it("has no LAN origin on loopback", () => {
		expect(
			reachableOrigins({ boundHost: "127.0.0.1", port: 4040, tailnetUrls: [], interfaces: LAPTOP }),
		).toEqual([]);
	});

	it("brackets an IPv6 LAN address", () => {
		expect(
			reachableOrigins({ boundHost: "2001:db8::1", port: 80, tailnetUrls: [], interfaces: {} }),
		).toEqual([{ url: "http://[2001:db8::1]:80", via: "lan" }]);
	});

	it("drops a tailnet URL that is not https", () => {
		expect(
			reachableOrigins({
				boundHost: "127.0.0.1",
				port: 4040,
				tailnetUrls: ["http://box.ts.net", "not a url", "https://box.ts.net/"],
				interfaces: {},
			}),
		).toEqual([{ url: "https://box.ts.net", via: "tailnet" }]);
	});
});

describe("shareOrigin", () => {
	const tailnet = { url: "https://box.ts.net", via: "tailnet" as const };
	const lan = { url: "http://192.168.1.23:4040", via: "lan" as const };

	it("prefers the tailnet address", () => {
		expect(shareOrigin([lan, tailnet], { preferLan: false })).toEqual({
			kind: "ok",
			origin: tailnet,
		});
	});

	it("uses the LAN address when there is no tailnet one", () => {
		expect(shareOrigin([lan], { preferLan: false })).toEqual({ kind: "ok", origin: lan });
	});

	it("uses the LAN address when it is preferred", () => {
		expect(shareOrigin([tailnet, lan], { preferLan: true })).toEqual({ kind: "ok", origin: lan });
	});

	it("is unreachable with no origin", () => {
		expect(shareOrigin([], { preferLan: false })).toEqual({ kind: "unreachable" });
	});

	it("has no LAN address to prefer on loopback", () => {
		expect(shareOrigin([tailnet], { preferLan: true })).toEqual({ kind: "no-lan" });
		expect(shareOrigin([], { preferLan: true })).toEqual({ kind: "no-lan" });
	});
});
