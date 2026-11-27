import { expect, it } from "vitest";
import { array, assert, constantFrom, integer, property, stringMatching, uuid } from "fast-check";
import { serverInfoSchema } from "@mdxserve/shared/server-info";
import { ServerInfoService } from "../../src/server-info/service.js";

// A MagicDNS name as Tailscale publishes it: a machine label of letters, digits and inner
// hyphens. A label with "--" in its third and fourth characters is reserved for punycode
// (RFC 5891), and an invalid one such as "xn--" is not a host a URL can hold; Tailscale never
// publishes one, so the generator leaves them out (seed 2014918914 found "xn--.tail0aaa.ts.net").
const hostname = stringMatching(
	/^[a-z]([a-z0-9-]{0,19}[a-z0-9])?\.tail[0-9a-f]{4}\.ts\.net$/,
).filter((host) => host.slice(2, 4) !== "--");

const answersWithAValidServerInfo = property(
	uuid({ version: 4 }),
	stringMatching(/^[A-Za-z0-9 ._-]{1,63}$/),
	constantFrom("full" as const, "restricted" as const),
	array(
		hostname.chain((host) =>
			integer({ min: 1, max: 65535 }).map((port) => (port === 443 ? host : `${host}:${port}`)),
		),
		{ maxLength: 20 },
	),
	(id, name, permissions, hosts) => {
		const service = new ServerInfoService(
			{ id, name, version: "1.2.3", permissions, mermaidVersion: "10.9.8" },
			{ current: () => new Set(hosts) },
		);
		const { info } = service.info();
		expect(serverInfoSchema.parse(info)).toEqual(info);
		expect(info.tailnetUrls.length).toBe(Math.min(8, new Set(hosts).size));
		for (const url of info.tailnetUrls) {
			expect(new URL(url).origin).toBe(url);
			expect(hosts).toContain(url.slice("https://".length));
		}
	},
);

it("always answers with a ServerInfo the shared schema accepts, with at most eight https origins", () => {
	assert(answersWithAValidServerInfo, { numRuns: 200 });
});

// The run that once generated "xn--.tail0aaa.ts.net", replayed on every run.
it("passes the run of seed 2014918914", () => {
	assert(answersWithAValidServerInfo, { seed: 2014918914, numRuns: 200 });
});
