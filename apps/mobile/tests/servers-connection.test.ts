import { describe, expect, it } from "@jest/globals";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import { connect, type ProbeResult } from "../src/servers/connection";
import type { KnownServer } from "../src/servers/store";

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
	it("uses the first address, HTTPS first, that answers with the stored id", async () => {
		const { asked, probe } = probeFrom({
			"https://box.tail1.ts.net:4040": { kind: "ok", info: info(ID) },
			"http://192.168.1.10:4040": { kind: "ok", info: info(ID) },
		});
		expect(await connect(server, probe)).toEqual({
			kind: "reachable",
			origin: "https://box.tail1.ts.net:4040",
			info: info(ID),
		});
		expect(asked).toEqual(["https://box.tail1.ts.net:4040"]);
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
});
