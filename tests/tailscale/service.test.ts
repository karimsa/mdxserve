import { describe, expect, it } from "vitest";
import { TailscaleService, type TailscaleRunner } from "../../src/tailscale/service.js";

const NAME = "box.tail1234.ts.net";
const APP = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const server = { port: 4040, boundHost: "127.0.0.1" };

function missing(): Error {
	return Object.assign(new Error("not found"), { code: "ENOENT" });
}

const RUNNING = JSON.stringify({ BackendState: "Running", Self: { DNSName: `${NAME}.` } });

/** A runner answering `status` and `serve status` from a table, keyed by CLI. */
function runner(
	answers: Record<string, { status?: string | Error; serve?: string | Error; code?: number }>,
): { run: TailscaleRunner; calls: string[] } {
	const calls: string[] = [];
	const run: TailscaleRunner = async (command, args) => {
		calls.push(`${command} ${args.join(" ")}`);
		const answer = answers[command];
		if (answer === undefined) throw missing();
		const output = args[0] === "serve" ? answer.serve : answer.status;
		if (output instanceof Error) throw output;
		return { code: answer.code ?? 0, stdout: output ?? "" };
	};
	return { run, calls };
}

describe("TailscaleService.detect", () => {
	it("is not-found when every candidate is missing", async () => {
		const { run, calls } = runner({});
		expect(await new TailscaleService(run, "darwin", {}).detect(server)).toEqual({
			kind: "not-found",
		});
		expect(calls).toEqual(["tailscale status --json", `${APP} status --json`]);
	});

	it("falls through to the app bundle when tailscale is not on PATH", async () => {
		const { run } = runner({ [APP]: { status: RUNNING, serve: "{}" } });
		expect(await new TailscaleService(run, "darwin", {}).detect(server)).toEqual({
			kind: "running",
			cli: APP,
			dnsName: NAME,
			addresses: [],
			unsupportedPaths: [],
			suggestedHttpsPort: 4040,
		});
	});

	it("uses only MDXSERVE_TAILSCALE_CLI when it is set", async () => {
		const { run, calls } = runner({});
		const env = { MDXSERVE_TAILSCALE_CLI: "/opt/fake" };
		expect(await new TailscaleService(run, "darwin", env).detect(server)).toEqual({
			kind: "not-found",
		});
		expect(calls).toEqual(["/opt/fake status --json"]);
	});

	it("is not-running when the backend is stopped or logged out", async () => {
		for (const state of ["Stopped", "NeedsLogin"]) {
			const { run, calls } = runner({
				tailscale: { status: JSON.stringify({ BackendState: state }) },
			});
			expect(await new TailscaleService(run, "linux", {}).detect(server)).toEqual({
				kind: "not-running",
				state,
			});
			expect(calls).toHaveLength(1);
		}
	});

	it("reports the addresses that reach this server, and a funnel", async () => {
		const serve = JSON.stringify({
			Web: {
				[`${NAME}:443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:4040" } } },
				[`${NAME}:8443`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } },
			},
			AllowFunnel: { [`${NAME}:443`]: true },
		});
		const { run } = runner({ tailscale: { status: RUNNING, serve } });
		expect(await new TailscaleService(run, "linux", {}).detect(server)).toMatchObject({
			kind: "running",
			cli: "tailscale",
			addresses: [{ host: NAME, url: `https://${NAME}/`, funnel: true }],
		});
	});

	it("suggests another HTTPS port when the server's port is taken in the serve config", async () => {
		const serve = JSON.stringify({
			TCP: { "4040": { HTTPS: true }, "443": { HTTPS: true } },
			Web: { [`${NAME}:4040`]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } },
		});
		const { run } = runner({ tailscale: { status: RUNNING, serve } });
		expect(await new TailscaleService(run, "linux", {}).detect(server)).toMatchObject({
			kind: "running",
			addresses: [],
			suggestedHttpsPort: 8443,
		});
	});

	it("reports a sub-path mount", async () => {
		const serve = JSON.stringify({
			Web: { [`${NAME}:443`]: { Handlers: { "/docs": { Proxy: "http://127.0.0.1:4040" } } } },
		});
		const { run } = runner({ tailscale: { status: RUNNING, serve } });
		expect(await new TailscaleService(run, "linux", {}).detect(server)).toMatchObject({
			kind: "running",
			addresses: [],
			unsupportedPaths: [`https://${NAME}/docs`],
		});
	});

	it("is failed on a timeout, a non-zero exit, garbage, or an unexpected shape", async () => {
		const cases = [
			{ status: new Error("Agent timed out; retry or choose another agent") },
			{ status: RUNNING, code: 1 },
			{ status: "not json at all" },
			{ status: JSON.stringify({ Version: "1" }) },
			{ status: RUNNING, serve: "garbage" },
			{ status: RUNNING, serve: JSON.stringify({ Web: 7 }) },
			{ status: RUNNING, serve: new Error("Agent output exceeded the limit") },
		];
		for (const answer of cases) {
			const { run } = runner({ tailscale: answer });
			const detection = await new TailscaleService(run, "linux", {}).detect(server);
			expect(detection.kind).toBe("failed");
		}
	});

	it("does not move on to the next candidate when the first runs but fails", async () => {
		const { run, calls } = runner({
			tailscale: { status: new Error("timed out") },
			[APP]: { status: RUNNING, serve: "{}" },
		});
		expect((await new TailscaleService(run, "darwin", {}).detect(server)).kind).toBe("failed");
		expect(calls).toEqual(["tailscale status --json"]);
	});
});
