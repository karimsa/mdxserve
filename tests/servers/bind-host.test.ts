import { expect, it } from "vitest";
import { array, assert, integer, property } from "fast-check";
import { admitBindHost } from "../../src/servers/bind-host.js";

it.each(["localhost", "LOCALHOST", "127.0.0.1", "127.0.0.2", "::1", "0:0:0:0:0:0:0:1"])(
	"allows loopback %s without network opt-in",
	(host) => {
		expect(admitBindHost(host).kind).toBe("ok");
	},
);
it("pins localhost to a literal address", () => {
	expect(admitBindHost("localhost")).toEqual({ kind: "ok", host: "127.0.0.1" });
});
it.each([
	"0.0.0.0",
	"::",
	"192.168.1.10",
	"10.0.0.1",
	"2001:db8::1",
	"docs.local",
	"localhost.example",
	"",
	"127.1",
	"2130706433",
])("requires opt-in for %s", (host) => {
	expect(admitBindHost(host)).toEqual({
		kind: "error",
		message: expect.stringContaining("--dangerous-allow-network"),
	});
	expect(admitBindHost(host, true)).toEqual({ kind: "ok", host });
});
it("rejects every non-loopback IPv4 address without opt-in", () => {
	assert(
		property(array(integer({ min: 0, max: 255 }), { minLength: 4, maxLength: 4 }), (octets) => {
			const host = octets.join(".");
			expect(admitBindHost(host).kind).toBe(octets[0] === 127 ? "ok" : "error");
		}),
	);
});
