import { describe, expect, it } from "vitest";
import { tailscaleReport, type ReportContext } from "../../src/tailscale/report.js";
import type { TailscaleDetection } from "../../src/tailscale/service.js";

const NAME = "box.tail1.ts.net";
const loopbackFull: ReportContext = {
	port: 4040,
	boundHost: "127.0.0.1",
	permissions: "full",
	debug: false,
};

function running(overrides: Partial<Extract<TailscaleDetection, { kind: "running" }>> = {}) {
	return {
		kind: "running" as const,
		cli: "tailscale",
		dnsName: NAME,
		addresses: [],
		unsupportedPaths: [],
		suggestedHttpsPort: 4040,
		...overrides,
	};
}

describe("tailscaleReport", () => {
	it("H3: says nothing when the CLI is missing or Tailscale is not running", () => {
		expect(tailscaleReport({ kind: "not-found" }, loopbackFull)).toEqual([]);
		expect(tailscaleReport({ kind: "not-running", state: "Stopped" }, loopbackFull)).toEqual([]);
	});

	it("says why detection failed only with MDXSERVE_DEBUG", () => {
		const failed = { kind: "failed" as const, message: "tailscale status --json exited with 1" };
		expect(tailscaleReport(failed, loopbackFull)).toEqual([]);
		expect(tailscaleReport(failed, { ...loopbackFull, debug: true })).toEqual([
			"mdxserve: Tailscale detection failed: tailscale status --json exited with 1",
		]);
	});

	it("H1: prints the serve command and the address it will have", () => {
		expect(tailscaleReport(running(), loopbackFull)).toEqual([
			"Tailscale is running. To open this server from your other devices over HTTPS:",
			"  tailscale serve --bg --https=4040 http://127.0.0.1:4040",
			`It will be at https://${NAME}:4040 (tailnet only).`,
			"Every device on your tailnet will be able to read and edit the mounted documents.",
		]);
	});

	it("H1: uses the located CLI path and a free HTTPS port", () => {
		const lines = tailscaleReport(
			running({
				cli: "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
				suggestedHttpsPort: 443,
			}),
			{ ...loopbackFull, permissions: "restricted" },
		);
		expect(lines).toEqual([
			"Tailscale is running. To open this server from your other devices over HTTPS:",
			"  /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=443 http://127.0.0.1:4040",
			`It will be at https://${NAME} (tailnet only).`,
		]);
	});

	it("quotes a CLI path with a space", () => {
		const lines = tailscaleReport(running({ cli: "/opt/my tools/tailscale" }), loopbackFull);
		expect(lines[1]).toBe(
			"  '/opt/my tools/tailscale' serve --bg --https=4040 http://127.0.0.1:4040",
		);
	});

	it("H2: tells a full server on the network that it can drop --host and --dangerous-allow-network", () => {
		for (const boundHost of ["0.0.0.0", "192.168.1.10"]) {
			const lines = tailscaleReport(running(), { ...loopbackFull, boundHost });
			expect(lines.at(-1)).toBe(
				"The tailnet address needs neither --host nor --dangerous-allow-network: restart without them to keep the server off your local network.",
			);
		}
		expect(tailscaleReport(running(), { ...loopbackFull, boundHost: "0.0.0.0" })[1]).toBe(
			"  tailscale serve --bg --https=4040 http://127.0.0.1:4040",
		);
	});

	it("S5: lists each tailnet address and prints no hint", () => {
		const lines = tailscaleReport(
			running({
				addresses: [
					{ host: NAME, url: `https://${NAME}/`, funnel: false },
					{ host: `${NAME}:8443`, url: `https://${NAME}:8443/`, funnel: false },
				],
			}),
			loopbackFull,
		);
		expect(lines).toEqual([
			`  - Tailnet:  https://${NAME} (tailnet, HTTPS)`,
			`  - Tailnet:  https://${NAME}:8443 (tailnet, HTTPS)`,
		]);
	});

	it("S6: warns about a funnelled address with full permissions only", () => {
		const detection = running({
			addresses: [{ host: `${NAME}:8443`, url: `https://${NAME}:8443/`, funnel: true }],
		});
		expect(tailscaleReport(detection, loopbackFull)).toEqual([
			`  - Tailnet:  https://${NAME}:8443 (public through Tailscale Funnel)`,
			`mdxserve: warning: https://${NAME}:8443 is public through Tailscale Funnel and this server has full permissions.`,
			"  Anyone on the internet can read and edit the mounted documents. Either:",
			"    turn Funnel off:  tailscale funnel --https=8443 off",
			"    or restart the server with --permissions restricted",
		]);
		expect(tailscaleReport(detection, { ...loopbackFull, permissions: "restricted" })).toEqual([
			`  - Tailnet:  https://${NAME}:8443 (public through Tailscale Funnel)`,
		]);
	});

	it("says a sub-path mount does not work", () => {
		const lines = tailscaleReport(
			running({ unsupportedPaths: [`https://${NAME}/docs`] }),
			loopbackFull,
		);
		expect(lines[0]).toBe(
			`mdxserve: https://${NAME}/docs proxies to this server with a path, which does not work: mount it at / with a target that has no path, such as http://127.0.0.1:4040.`,
		);
		expect(lines[1]).toContain("Tailscale is running");
	});
});
