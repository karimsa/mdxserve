import { expect, it } from "vitest";
import { array, assert, constantFrom, integer, property, stringMatching, uuid } from "fast-check";
import { serverInfoSchema } from "@mdxserve/shared/server-info";
import { ServerInfoService } from "../../src/server-info/service.js";

const hostname = stringMatching(/^[a-z][a-z0-9-]{0,20}\.tail[0-9a-f]{4}\.ts\.net$/);

it("always answers with a ServerInfo the shared schema accepts, with at most eight https origins", () => {
	assert(
		property(
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
		),
		{ numRuns: 200 },
	);
});
