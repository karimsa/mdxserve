import { describe, expect, it } from "vitest";
import { encode } from "uqr";
import { NO_LAN_MESSAGE, UNREACHABLE_MESSAGE, runQr } from "../../src/cli/qr.js";
import { NO_SERVER_MESSAGE } from "../../src/cli/format.js";
import type { NetworkInterfaces } from "../../src/discovery/addresses.js";
import type { ServerRecord } from "../../src/servers/server-registry.js";
import { fakeLiveServer } from "../helpers/remote.js";
import { testServerInfo, TEST_IDENTITY } from "../helpers/server-info.js";

const WIFI: NetworkInterfaces = {
	lo0: [
		{
			address: "127.0.0.1",
			netmask: "255.0.0.0",
			family: "IPv4",
			mac: "00:00:00:00:00:00",
			internal: true,
			cidr: "127.0.0.1/8",
		},
	],
	en0: [
		{
			address: "192.168.1.23",
			netmask: "255.255.255.0",
			family: "IPv4",
			mac: "00:00:00:00:00:00",
			internal: false,
			cidr: "192.168.1.23/24",
		},
	],
};

const TAILNET_HOST = "box.tail1234.ts.net:4040";

function server(options: { host?: string; tailnetHosts?: string[] } = {}) {
	const record: Partial<ServerRecord> = { host: options.host ?? "127.0.0.1", port: 4040 };
	const info = testServerInfo({}, options.tailnetHosts ?? []).info().info;
	return fakeLiveServer({
		record,
		remote: { getServerInfo: async () => ({ kind: "ok", value: info }) },
	});
}

async function qr(
	options: { lan?: boolean; json?: boolean },
	live = server({ tailnetHosts: [TAILNET_HOST] }),
	color = false,
) {
	return runQr(options, { server: live, interfaces: WIFI, color });
}

describe("runQr", () => {
	it("prints the code, then the tailnet URL and how to scan it", async () => {
		const outcome = await qr({});
		expect(outcome.exitCode).toBe(0);
		const url = `https://${TAILNET_HOST}`;
		const urlIndex = outcome.stdout.indexOf(url);
		expect(urlIndex).toBeGreaterThan(10);
		expect(outcome.stdout.slice(0, urlIndex).every((line) => /^[ ▀▄█]+$/.test(line))).toBe(true);
		expect(outcome.stdout.at(-1)).toContain("The phone must be on your tailnet.");
	});

	it("draws the payload's QR code, two rows to a line", async () => {
		const outcome = await qr({});
		const payload = `https://${TAILNET_HOST}/#mdxserve=${TEST_IDENTITY.id}`;
		const matrix = encode(payload, { ecc: "M", border: 2 }).data;
		const lines = outcome.stdout.slice(0, outcome.stdout.indexOf(`https://${TAILNET_HOST}`));
		expect(lines).toHaveLength(Math.ceil(matrix.length / 2));
		lines.forEach((line, lineIndex) => {
			[...line].forEach((cell, column) => {
				// `true` is a dark module; below the last row counts as dark.
				const top = matrix[lineIndex * 2]?.[column] ?? true;
				const bottom = matrix[lineIndex * 2 + 1]?.[column] ?? true;
				const expected = top ? (bottom ? " " : "▄") : bottom ? "▀" : "█";
				expect(cell).toBe(expected);
			});
		});
	});

	it("holds the origin and the server id, and nothing else, with --json", async () => {
		const outcome = await qr({ json: true });
		expect(outcome.exitCode).toBe(0);
		expect(JSON.parse(outcome.stdout.join("\n"))).toEqual({
			url: `https://${TAILNET_HOST}`,
			payload: `https://${TAILNET_HOST}/#mdxserve=${TEST_IDENTITY.id}`,
			via: "tailnet",
		});
	});

	it("uses the LAN address with --lan", async () => {
		const outcome = await qr(
			{ json: true, lan: true },
			server({ host: "0.0.0.0", tailnetHosts: [TAILNET_HOST] }),
		);
		expect(JSON.parse(outcome.stdout.join("\n"))).toMatchObject({
			url: "http://192.168.1.23:4040",
			via: "lan",
		});
	});

	it("uses the LAN address when there is no tailnet one", async () => {
		const outcome = await qr({}, server({ host: "192.168.1.23" }));
		expect(outcome.exitCode).toBe(0);
		expect(outcome.stdout).toContain("http://192.168.1.23:4040");
		expect(outcome.stdout.at(-1)).toContain("on the same network as this computer");
	});

	it("exits 1 and says why when only this computer can open the server (Q3)", async () => {
		const outcome = await qr({}, server());
		expect(outcome).toEqual({
			exitCode: 1,
			stdout: [],
			stderr: [`mdxserve: ${UNREACHABLE_MESSAGE}`],
		});
	});

	it("exits 1 with --lan on a loopback server", async () => {
		const outcome = await qr({ lan: true });
		expect(outcome.exitCode).toBe(1);
		expect(outcome.stderr).toEqual([`mdxserve: ${NO_LAN_MESSAGE}`]);
	});

	it("exits 1 with no server", async () => {
		const outcome = await qr({}, fakeLiveServer({ running: false }));
		expect(outcome.stderr).toEqual([`mdxserve: ${NO_SERVER_MESSAGE}`]);
		expect(outcome.exitCode).toBe(1);
	});

	it("exits 1 when the server does not answer", async () => {
		const outcome = await qr({}, fakeLiveServer());
		expect(outcome.stderr).toEqual([
			"mdxserve: the server at http://127.0.0.1:4040 did not answer",
		]);
	});

	it("passes on the server's error, such as an older server without getServerInfo", async () => {
		const outcome = await qr(
			{},
			fakeLiveServer({
				remote: { getServerInfo: async () => ({ kind: "error", message: "No procedure found" }) },
			}),
		);
		expect(outcome.stderr).toEqual(["mdxserve: No procedure found"]);
	});

	it("draws white blocks on black in a colour terminal", async () => {
		const outcome = await qr({}, undefined, true);
		const code = outcome.stdout.slice(0, outcome.stdout.indexOf(`https://${TAILNET_HOST}`));
		for (const line of code) {
			expect(line.startsWith("\u001B[97;40m")).toBe(true);
			expect(line.endsWith("\u001B[0m")).toBe(true);
		}
	});

	it("fits an 80-column, 40-row terminal with the longest tailnet name (Q5)", async () => {
		// A DNS label is at most 63 bytes, and a tailnet name is <machine>.<tailnet>.ts.net.
		const host = `${"m".repeat(63)}.${"t".repeat(63)}.ts.net:10000`;
		const outcome = await qr({}, server({ tailnetHosts: [host] }));
		expect(outcome.exitCode).toBe(0);
		const code = outcome.stdout.slice(0, outcome.stdout.indexOf(`https://${host}`));
		expect(outcome.stdout.length).toBeLessThanOrEqual(40);
		for (const line of code) expect([...line].length).toBeLessThanOrEqual(80);
	});
});
