import { describe, expect, it } from "@jest/globals";
import {
	assert,
	asyncProperty,
	constantFrom,
	integer,
	oneof,
	record,
	uniqueArray,
} from "fast-check";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import { connect, type ProbeResult } from "../src/servers/connection";
import { orderedAddresses, type KnownServer } from "../src/servers/store";

const ID = "5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e";
const OTHER = "0d6f3b1a-8c2e-4f5d-a7b9-1e3c5a7b9d0f";

function info(id: string): ServerInfo {
	return {
		id,
		name: "box",
		version: "0.7.0",
		permissions: "full",
		mermaidVersion: "10.9.8",
		treeSchemaVersion: 1,
		tailnetUrls: [],
	};
}

const server: KnownServer = {
	id: ID,
	name: "box",
	version: "0.7.0",
	permissions: "full",
	treeSchemaVersion: 1,
	addedAt: "2026-11-27T12:00:00.000Z",
	addresses: [
		{ url: "http://192.168.1.10:4040", source: "manual", lastOkAt: "2026-11-27T12:00:00.000Z" },
		{ url: "https://box.tail1.ts.net:4040", source: "manual" },
	],
};

/** A probe that answers from a table, and records what it was asked in order. */
function probeFrom(answers: Record<string, ProbeResult>) {
	const asked: string[] = [];
	return {
		asked,
		probe: async (origin: string): Promise<ProbeResult> => {
			asked.push(origin);
			return answers[origin] ?? { kind: "failed", cause: "no answer" };
		},
	};
}

describe("connect", () => {
	it("asks every address at once and uses the first, HTTPS first, that answers with the stored id", async () => {
		const { asked, probe } = probeFrom({
			"https://box.tail1.ts.net:4040": { kind: "ok", info: info(ID) },
			"http://192.168.1.10:4040": { kind: "ok", info: info(ID) },
		});
		expect(await connect(server, probe)).toEqual({
			kind: "reachable",
			origin: "https://box.tail1.ts.net:4040",
			info: info(ID),
		});
		expect(asked).toEqual(["https://box.tail1.ts.net:4040", "http://192.168.1.10:4040"]);
	});

	it("skips an address that fails and one that is now another server", async () => {
		const { probe } = probeFrom({
			"https://box.tail1.ts.net:4040": { kind: "ok", info: info(OTHER) },
			"http://192.168.1.10:4040": { kind: "ok", info: info(ID) },
		});
		expect(await connect(server, probe)).toMatchObject({
			kind: "reachable",
			origin: "http://192.168.1.10:4040",
		});
	});

	it("is changed when the only answers came from another server", async () => {
		const { probe } = probeFrom({
			"https://box.tail1.ts.net:4040": { kind: "ok", info: info(OTHER) },
		});
		expect(await connect(server, probe)).toEqual({
			kind: "changed",
			origins: ["https://box.tail1.ts.net:4040"],
		});
	});

	it("is unreachable with each address's cause when nothing answers", async () => {
		const { probe } = probeFrom({});
		expect(await connect(server, probe)).toEqual({
			kind: "unreachable",
			causes: [
				{ origin: "https://box.tail1.ts.net:4040", cause: "no answer" },
				{ origin: "http://192.168.1.10:4040", cause: "no answer" },
			],
		});
	});

	it("is unreachable for a server with no address", async () => {
		const { probe } = probeFrom({});
		expect(await connect({ ...server, addresses: [] }, probe)).toEqual({
			kind: "unreachable",
			causes: [],
		});
	});

	it("takes no longer than its slowest address (C6)", async () => {
		const slow = (result: ProbeResult) =>
			new Promise<ProbeResult>((resolve) => setTimeout(() => resolve(result), 200));
		const dead: KnownServer = {
			...server,
			addresses: [
				{ url: "https://dead1.tail1.ts.net", source: "manual" },
				{ url: "https://dead2.tail1.ts.net", source: "manual" },
				{ url: "https://dead3.tail1.ts.net", source: "manual" },
				{ url: "http://192.168.1.10:4040", source: "manual" },
			],
		};
		const started = Date.now();
		const connection = await connect(dead, (origin) =>
			slow(
				origin.startsWith("http://")
					? { kind: "ok", info: info(ID) }
					: { kind: "failed", cause: "no answer within 5 seconds" },
			),
		);
		expect(connection).toMatchObject({ kind: "reachable", origin: "http://192.168.1.10:4040" });
		expect(Date.now() - started).toBeLessThan(600);
	});
});

/** What asking the addresses one after another gives: the rule `connect` must keep. */
async function connectInTurn(target: KnownServer, probe: (origin: string) => Promise<ProbeResult>) {
	const changed: string[] = [];
	const causes: Array<{ origin: string; cause: string }> = [];
	for (const address of orderedAddresses(target)) {
		const result = await probe(address.url);
		if (result.kind === "failed") causes.push({ origin: address.url, cause: result.cause });
		else if (result.info.id === target.id) {
			return { kind: "reachable", origin: address.url, info: result.info };
		} else changed.push(address.url);
	}
	return changed.length > 0
		? { kind: "changed", origins: changed }
		: { kind: "unreachable", causes };
}

describe("connect (property)", () => {
	const URLS = [
		"https://a.tail1.ts.net",
		"https://b.tail1.ts.net:4040",
		"http://192.168.1.10:4040",
		"http://10.0.0.5:4040",
	];
	const outcome = oneof(
		record({ kind: constantFrom("ok" as const), id: constantFrom(ID, OTHER) }),
		record({ kind: constantFrom("failed" as const), id: constantFrom("") }),
	);

	it("gives what asking in turn gives, for any answers and delays", async () => {
		await assert(
			asyncProperty(
				uniqueArray(
					record({
						url: constantFrom(...URLS),
						outcome,
						delay: integer({ min: 0, max: 5 }),
						reached: constantFrom(
							undefined,
							"2026-11-26T12:00:00.000Z",
							"2026-11-27T12:00:00.000Z",
						),
					}),
					{ maxLength: 4, selector: (entry) => entry.url },
				),
				async (entries) => {
					const target: KnownServer = {
						...server,
						addresses: entries.map((entry) => ({
							url: entry.url,
							source: "manual",
							...(entry.reached === undefined ? {} : { lastOkAt: entry.reached }),
						})),
					};
					const probe = (origin: string) => {
						const entry = entries.find((candidate) => candidate.url === origin);
						const result: ProbeResult =
							entry?.outcome.kind === "ok"
								? { kind: "ok", info: info(entry.outcome.id) }
								: { kind: "failed", cause: `no answer from ${origin}` };
						return new Promise<ProbeResult>((resolve) =>
							setTimeout(() => resolve(result), entry?.delay ?? 0),
						);
					};
					expect(await connect(target, probe)).toEqual(await connectInTurn(target, probe));
				},
			),
			{ numRuns: 100 },
		);
	});
});
