import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { announceTailscale, serverTailnetHosts } from "../../src/tailscale/startup.js";
import type { ReportContext } from "../../src/tailscale/report.js";

// Each case is a fake `tailscale` script handed to the server through
// MDXSERVE_TAILSCALE_CLI, run by the real process runner. None of them is
// the real CLI.

const NAME = "box.tail1234.ts.net";
const PORT = 4040;
const RUNNING = JSON.stringify({ BackendState: "Running", Self: { DNSName: `${NAME}.` } });

let dir: string;
let stdout: string[];
let stderr: string[];

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-fake-tailscale-"));
});

afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
	stdout = [];
	stderr = [];
	vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
		stdout.push(String(chunk));
		return true;
	});
	vi.spyOn(console, "log").mockImplementation((...args) => {
		stdout.push(args.join(" "));
	});
	vi.spyOn(console, "error").mockImplementation((...args) => {
		stderr.push(args.join(" "));
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** A POSIX shell script that prints `status` for `status --json` and `serve` for `serve status --json`. */
async function fakeCli(name: string, status: string, serve: string): Promise<string> {
	const file = path.join(dir, name);
	const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;
	await fs.writeFile(
		file,
		[
			"#!/bin/sh",
			'if [ "$1" = "status" ]; then',
			`  ${status.startsWith("sh:") ? status.slice(3) : `printf '%s' ${quote(status)}`}`,
			'elif [ "$1" = "serve" ]; then',
			`  printf '%s' ${quote(serve)}`,
			"fi",
			"",
		].join("\n"),
		{ mode: 0o755 },
	);
	return file;
}

function serveConfig(port: number, mountPath = "/", funnel = false): string {
	const key = `${NAME}:${port}`;
	return JSON.stringify({
		TCP: { [String(port)]: { HTTPS: true } },
		Web: { [key]: { Handlers: { [mountPath]: { Proxy: `http://127.0.0.1:${PORT}` } } } },
		...(funnel ? { AllowFunnel: { [key]: true } } : {}),
	});
}

async function run(cli: string, context: Partial<ReportContext> = {}) {
	const hosts = serverTailnetHosts(() => ({ port: PORT, boundHost: "127.0.0.1" }), "linux", {
		MDXSERVE_TAILSCALE_CLI: cli,
	});
	await announceTailscale(hosts, {
		port: PORT,
		boundHost: "127.0.0.1",
		permissions: "full",
		debug: false,
		...context,
	});
	return hosts;
}

describe("startup output with a fake Tailscale CLI", () => {
	it("prints nothing when the CLI is not found", async () => {
		await run(path.join(dir, "does-not-exist"));
		expect(stderr).toEqual([]);
		expect(stdout).toEqual([]);
	});

	it("prints nothing when Tailscale is not running", async () => {
		await run(await fakeCli("stopped", JSON.stringify({ BackendState: "Stopped" }), "{}"));
		expect(stderr).toEqual([]);
		expect(stdout).toEqual([]);
	});

	it("prints the hint when no entry reaches the server", async () => {
		const cli = await fakeCli("no-entry", RUNNING, "{}");
		await run(cli);
		expect(stdout).toEqual([]);
		expect(stderr.join("\n")).toBe(
			[
				"Tailscale is running. To open this server from your other devices over HTTPS:",
				`  ${cli} serve --bg --https=4040 http://127.0.0.1:4040`,
				`It will be at https://${NAME}:4040 (tailnet only).`,
				"Every device on your tailnet will be able to read and edit the mounted documents.",
			].join("\n"),
		);
	});

	it("lists a matching entry and trusts its Host", async () => {
		const hosts = await run(await fakeCli("matching", RUNNING, serveConfig(443)));
		expect(stdout).toEqual([]);
		expect(stderr).toEqual([`  - Tailnet:  https://${NAME} (tailnet, HTTPS)`]);
		expect([...hosts.current()]).toEqual([NAME]);
	});

	it("warns about a funnelled entry in full mode", async () => {
		await run(await fakeCli("funnel", RUNNING, serveConfig(8443, "/", true)));
		expect(stdout).toEqual([]);
		expect(stderr.join("\n")).toContain(
			"is public through Tailscale Funnel and this server has full permissions",
		);
		expect(stderr.join("\n")).toContain("funnel --https=8443 off");
	});

	it("says a sub-path entry does not work", async () => {
		const hosts = await run(await fakeCli("subpath", RUNNING, serveConfig(443, "/docs")));
		expect(stdout).toEqual([]);
		expect(stderr.join("\n")).toContain(
			`https://${NAME}/docs proxies to this server under a sub-path`,
		);
		expect(hosts.current().size).toBe(0);
	});

	it("gives up on a CLI that hangs, quietly unless MDXSERVE_DEBUG is set", async () => {
		const cli = await fakeCli("hangs", "sh:sleep 30", "{}");
		const started = Date.now();
		await run(cli, { debug: true });
		expect(Date.now() - started).toBeLessThan(6000);
		expect(stdout).toEqual([]);
		expect(stderr.join("\n")).toMatch(/^mdxserve: Tailscale detection failed: /);
	}, 10_000);

	it("prints nothing for a CLI that prints garbage", async () => {
		await run(await fakeCli("garbage", "]]] not json", "{}"));
		expect(stderr).toEqual([]);
		expect(stdout).toEqual([]);
	});
});
