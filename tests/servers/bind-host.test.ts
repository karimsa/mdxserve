import { expect, it } from "vitest";
import { array, assert, integer, property } from "fast-check";
import { resolveBindPermissions } from "../../src/servers/bind-host.js";

it.each(["localhost", "LOCALHOST", "127.0.0.1", "127.0.0.2", "::1", "0:0:0:0:0:0:0:1"])(
	"defaults loopback %s to full permissions",
	(host) => {
		expect(resolveBindPermissions(host, undefined)).toEqual({
			kind: "ok",
			host:
				host.toLowerCase() === "localhost"
					? "127.0.0.1"
					: host === "0:0:0:0:0:0:0:1"
						? "::1"
						: host,
			permissions: "full",
		});
		expect(resolveBindPermissions(host, "restricted")).toMatchObject({
			kind: "ok",
			permissions: "restricted",
		});
	},
);

it.each([
	"0.0.0.0",
	"::",
	"192.168.1.10",
	"10.0.0.1",
	"2001:db8::1",
	"docs.local",
	"::ffff:127.0.0.1",
	"127.1",
	"2130706433",
])("defaults non-loopback %s to restricted despite the dangerous flag", (host) => {
	expect(resolveBindPermissions(host, undefined)).toEqual({
		kind: "ok",
		host,
		permissions: "restricted",
	});
	expect(resolveBindPermissions(host, undefined, true)).toEqual({
		kind: "ok",
		host,
		permissions: "restricted",
	});
	expect(resolveBindPermissions(host, "restricted", true)).toEqual({
		kind: "ok",
		host,
		permissions: "restricted",
	});
	expect(resolveBindPermissions(host, "full")).toEqual({
		kind: "error",
		message: expect.stringContaining("--dangerous-allow-network"),
	});
	expect(resolveBindPermissions(host, "full", true)).toEqual({
		kind: "ok",
		host,
		permissions: "full",
	});
});

it("rejects an unknown permissions mode before binding", () => {
	expect(resolveBindPermissions("127.0.0.1", "sandbox")).toEqual({
		kind: "error",
		message: expect.stringContaining("invalid permissions mode"),
	});
	expect(resolveBindPermissions("0.0.0.0", "sandbox", true).kind).toBe("error");
});

it("only defaults IPv4 loopback addresses to full", () => {
	assert(
		property(array(integer({ min: 0, max: 255 }), { minLength: 4, maxLength: 4 }), (octets) => {
			const host = octets.join(".");
			expect(resolveBindPermissions(host, undefined)).toMatchObject({
				kind: "ok",
				permissions: octets[0] === 127 ? "full" : "restricted",
			});
		}),
	);
});
