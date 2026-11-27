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
	it("holds the lower-cased hosts of the last running detection", async () => {
		const hosts = new TailnetHosts(async () =>
			running(["Box.Tail1.ts.net", "box.tail1.ts.net:8443"]),
		);
		expect(hosts.current().size).toBe(0);
		await hosts.refresh();
		expect([...hosts.current()]).toEqual(["box.tail1.ts.net", "box.tail1.ts.net:8443"]);
	});

	it("runs detection at most once per floor window and shares an in-flight call", async () => {
		let clock = 0;
		let calls = 0;
		const hosts = new TailnetHosts(
			async () => {
				calls += 1;
				return running([`host${calls}.ts.net`]);
			},
			10_000,
			() => clock,
		);
		await Promise.all([hosts.refresh(), hosts.refresh(), hosts.refresh()]);
		expect(calls).toBe(1);
		clock = 9_999;
		await hosts.refresh();
		expect(calls).toBe(1);
		clock = 10_000;
		await hosts.refresh();
		expect(calls).toBe(2);
		expect([...hosts.current()]).toEqual(["host2.ts.net"]);
	});

	it("drops the hosts when Tailscale stops, keeps them when a call fails", async () => {
		let clock = 0;
		const answers: TailscaleDetection[] = [
			running(["box.ts.net"]),
			{ kind: "failed", message: "timed out" },
			{ kind: "not-running", state: "Stopped" },
		];
		const hosts = new TailnetHosts(
			async () => answers.shift() ?? { kind: "not-found" },
			1,
			() => clock,
		);
		await hosts.refresh();
		clock += 1;
		await hosts.refresh();
		expect([...hosts.current()]).toEqual(["box.ts.net"]);
		clock += 1;
		await hosts.refresh();
		expect(hosts.current().size).toBe(0);
	});

	it("never rejects, even when detection does", async () => {
		const hosts = new TailnetHosts(() => Promise.reject(new Error("boom")));
		expect((await hosts.refresh()).kind).toBe("failed");
	});
});
