import { describe, expect, it } from "vitest";
import { TailnetHosts } from "../../src/tailscale/tailnet-hosts.js";
import type { TailscaleDetection } from "../../src/tailscale/service.js";

function running(hosts: string[]): TailscaleDetection {
	return {
		kind: "running",
		cli: "tailscale",
		dnsName: "box.tail1.ts.net",
		addresses: hosts.map((host) => ({ host, url: `https://${host}/`, funnel: false })),
		unsupportedPaths: [],
		suggestedHttpsPort: 4040,
	};
}

describe("TailnetHosts", () => {
	it("holds the lower-cased hosts of a running detection", async () => {
		const hosts = new TailnetHosts(async () =>
			running(["Box.Tail1.ts.net", "box.tail1.ts.net:8443"]),
		);
		expect(hosts.current().size).toBe(0);
		await hosts.detect();
		expect([...hosts.current()]).toEqual(["box.tail1.ts.net", "box.tail1.ts.net:8443"]);
	});

	it("runs detection once, however often it is asked", async () => {
		let calls = 0;
		const hosts = new TailnetHosts(async () => {
			calls += 1;
			return running([`host${calls}.ts.net`]);
		});
		await Promise.all([hosts.detect(), hosts.detect()]);
		await hosts.detect();
		expect(calls).toBe(1);
		expect([...hosts.current()]).toEqual(["host1.ts.net"]);
	});

	it("holds no hosts when Tailscale is not running", async () => {
		const hosts = new TailnetHosts(async () => ({ kind: "not-running", state: "Stopped" }));
		expect((await hosts.detect()).kind).toBe("not-running");
		expect(hosts.current().size).toBe(0);
	});

	it("never rejects, even when detection does", async () => {
		const hosts = new TailnetHosts(() => Promise.reject(new Error("boom")));
		expect((await hosts.detect()).kind).toBe("failed");
		expect(hosts.current().size).toBe(0);
	});
});
