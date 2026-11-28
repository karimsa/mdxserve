import { describe, expect, it } from "@jest/globals";
import {
	type Arbitrary,
	array,
	assert,
	asyncProperty,
	constantFrom,
	integer,
	oneof,
	property,
	record,
	tuple,
} from "fast-check";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import { normaliseOrigin } from "../src/servers/origin";
import {
	SERVERS_KEY,
	addServer,
	loadServers,
	orderedAddresses,
	removeServer,
	renameServer,
	saveServers,
	recordReached,
	type KnownServer,
	type SourcedOrigin,
} from "../src/servers/store";
import { createMemoryStorage } from "../src/servers/storage";

const NOW = new Date("2026-11-27T12:00:00.000Z");

/** Addresses the reader typed. */
function typed(urls: readonly string[]): SourcedOrigin[] {
	return urls.map((url) => ({ url, source: "manual" }));
}
const IDS = [
	"5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e",
	"0d6f3b1a-8c2e-4f5d-a7b9-1e3c5a7b9d0f",
	"c4e6a8b0-d2f4-4a6c-8e0b-2d4f6a8c0e1b",
];
const ORIGINS = [
	"https://box.tail1.ts.net:4040",
	"https://box.tail1.ts.net",
	"http://192.168.1.10:4040",
	"http://10.0.0.5:4040",
];

function info(id: string, overrides: Partial<ServerInfo> = {}): ServerInfo {
	return {
		id,
		name: "box",
		version: "0.7.0",
		permissions: "full",
		mermaidVersion: "10.9.8",
		treeSchemaVersion: 1,
		tailnetUrls: [],
		...overrides,
	};
}

describe("normaliseOrigin", () => {
	it("keeps only the origin and takes https when no scheme is given", () => {
		expect(normaliseOrigin(" https://Box.tail1.ts.net:4040/notes/a.md?x=1#y ")).toEqual({
			kind: "ok",
			origin: "https://box.tail1.ts.net:4040",
		});
		expect(normaliseOrigin("box.tail1.ts.net")).toEqual({
			kind: "ok",
			origin: "https://box.tail1.ts.net",
		});
		expect(normaliseOrigin("http://192.168.1.10:4040/")).toEqual({
			kind: "ok",
			origin: "http://192.168.1.10:4040",
		});
	});

	it("refuses an empty address, another scheme and credentials", () => {
		expect(normaliseOrigin("  ").kind).toBe("error");
		expect(normaliseOrigin("ftp://box").kind).toBe("error");
		expect(normaliseOrigin("https://me:secret@box").kind).toBe("error");
	});
});

describe("addServer", () => {
	it("creates a server with the answering address, then its tailnet URLs as reported", () => {
		const servers = addServer(
			[],
			info(IDS[0], { tailnetUrls: ["https://box.tail1.ts.net:4040", "http://box.plain:4040"] }),
			[{ url: "http://192.168.1.10:4040", source: "qr" }],
			NOW,
		);
		expect(servers).toEqual([
			{
				id: IDS[0],
				name: "box",
				version: "0.7.0",
				permissions: "full",
				treeSchemaVersion: 1,
				addedAt: NOW.toISOString(),
				addresses: [
					{ url: "http://192.168.1.10:4040", source: "qr", lastOkAt: NOW.toISOString() },
					{ url: "https://box.tail1.ts.net:4040", source: "reported" },
				],
			},
		]);
	});

	it("marks every origin that answered as reached, and keeps an address's first source", () => {
		const first = addServer([], info(IDS[0]), typed([ORIGINS[0]]), NOW);
		const later = new Date("2026-11-28T12:00:00.000Z");
		const servers = addServer(
			first,
			info(IDS[0], { tailnetUrls: [ORIGINS[0]] }),
			[
				{ url: ORIGINS[0], source: "qr" },
				{ url: ORIGINS[2], source: "qr" },
			],
			later,
		);
		expect(servers[0].addresses).toEqual([
			{ url: ORIGINS[0], source: "manual", lastOkAt: later.toISOString() },
			{ url: ORIGINS[2], source: "qr", lastOkAt: later.toISOString() },
		]);
	});

	it("appends a second address of a known server to it, keeping its label (C5)", () => {
		const first = renameServer(
			addServer([], info(IDS[0]), typed([ORIGINS[0]]), NOW),
			IDS[0],
			"Studio",
		);
		const servers = addServer(first, info(IDS[0], { name: "box2" }), typed([ORIGINS[2]]), NOW);
		expect(servers).toHaveLength(1);
		expect(servers[0].label).toBe("Studio");
		expect(servers[0].name).toBe("box2");
		expect(servers[0].addresses.map((address) => address.url)).toEqual([ORIGINS[0], ORIGINS[2]]);
	});

	it("moves an address that now answers as another server", () => {
		const first = addServer([], info(IDS[0]), typed([ORIGINS[0], ORIGINS[2]]), NOW);
		const servers = addServer(first, info(IDS[1]), typed([ORIGINS[2]]), NOW);
		expect(servers.map((server) => server.addresses.map((address) => address.url))).toEqual([
			[ORIGINS[0]],
			[ORIGINS[2]],
		]);
	});
});

describe("recordReached", () => {
	const reported = "https://box.tail1.ts.net";

	it("adds the server's new tailnet URLs when it answered over HTTPS", () => {
		const servers = addServer([], info(IDS[0]), typed([ORIGINS[0]]), NOW);
		const later = new Date("2026-11-28T12:00:00.000Z");
		const reached = recordReached(
			servers,
			info(IDS[0], { name: "box2", tailnetUrls: [ORIGINS[0], reported] }),
			ORIGINS[0],
			later,
		);
		expect(reached[0].name).toBe("box2");
		expect(reached[0].addresses).toEqual([
			{ url: ORIGINS[0], source: "manual", lastOkAt: later.toISOString() },
			{ url: reported, source: "reported" },
		]);
	});

	it("adds nothing when it answered over plain HTTP (I2)", () => {
		const servers = addServer([], info(IDS[0]), typed([ORIGINS[2]]), NOW);
		const reached = recordReached(
			servers,
			info(IDS[0], { tailnetUrls: [reported] }),
			ORIGINS[2],
			NOW,
		);
		expect(reached[0].addresses.map((address) => address.url)).toEqual([ORIGINS[2]]);
	});

	it("leaves a server it does not know alone", () => {
		const servers = addServer([], info(IDS[0]), typed([ORIGINS[0]]), NOW);
		expect(recordReached(servers, info(IDS[1]), ORIGINS[0], NOW)).toEqual(servers);
	});
});

describe("renameServer and removeServer", () => {
	it("sets and clears the reader's label, and removes by id", () => {
		const servers = addServer([], info(IDS[0]), typed([ORIGINS[0]]), NOW);
		expect(renameServer(servers, IDS[0], "  Studio ")[0].label).toBe("Studio");
		expect(
			renameServer(renameServer(servers, IDS[0], "Studio"), IDS[0], " ")[0],
		).not.toHaveProperty("label");
		expect(removeServer(servers, IDS[0])).toEqual([]);
	});
});

describe("orderedAddresses", () => {
	it("tries HTTPS first, then the most recently reached", () => {
		const server: KnownServer = {
			...addServer([], info(IDS[0]), typed([ORIGINS[2]]), NOW)[0],
			addresses: [
				{ url: ORIGINS[2], source: "manual", lastOkAt: "2026-11-27T12:00:00.000Z" },
				{ url: ORIGINS[1], source: "manual" },
				{ url: ORIGINS[0], source: "manual", lastOkAt: "2026-11-26T12:00:00.000Z" },
				{ url: ORIGINS[3], source: "manual" },
			],
		};
		expect(orderedAddresses(server).map((address) => address.url)).toEqual([
			ORIGINS[0],
			ORIGINS[1],
			ORIGINS[2],
			ORIGINS[3],
		]);
	});
});

describe("loadServers and saveServers", () => {
	it("round-trips the list through storage", async () => {
		const storage = createMemoryStorage();
		const servers = addServer([], info(IDS[0]), typed([ORIGINS[0]]), NOW);
		await saveServers(storage, servers);
		expect(await loadServers(storage)).toEqual({ kind: "ok", servers });
	});

	it("reads nothing stored as an empty list", async () => {
		expect(await loadServers(createMemoryStorage())).toEqual({ kind: "ok", servers: [] });
	});

	it("reports a value that is not JSON or fails the schema, and reads it as empty", async () => {
		for (const value of ["{", JSON.stringify({ servers: [{ id: "x" }] })]) {
			const result = await loadServers(createMemoryStorage({ [SERVERS_KEY]: value }));
			expect(result).toMatchObject({ kind: "corrupt", servers: [] });
		}
	});
});

/** One step a reader can take on the list. */
type Step =
	| readonly ["add", string, readonly string[]]
	| readonly ["rename", string, string]
	| readonly ["remove", string]
	| readonly ["reach", string, string, readonly string[]];

const operation: Arbitrary<Step> = oneof(
	tuple(
		constantFrom("add" as const),
		constantFrom(...IDS),
		array(constantFrom(...ORIGINS), { minLength: 1, maxLength: 4 }),
	),
	tuple(
		constantFrom("rename" as const),
		constantFrom(...IDS),
		constantFrom("", "Studio", "Laptop"),
	),
	tuple(constantFrom("remove" as const), constantFrom(...IDS)),
	tuple(
		constantFrom("reach" as const),
		constantFrom(...IDS),
		constantFrom(...ORIGINS),
		array(constantFrom(...ORIGINS), { maxLength: 3 }),
	),
);

function apply(servers: KnownServer[], step: Step): KnownServer[] {
	if (step[0] === "add") return addServer(servers, info(step[1]), typed(step[2]), NOW);
	if (step[0] === "rename") return renameServer(servers, step[1], step[2]);
	if (step[0] === "reach") {
		return recordReached(servers, info(step[1], { tailnetUrls: [...step[3]] }), step[2], NOW);
	}
	return removeServer(servers, step[1]);
}

describe("the server list (property)", () => {
	it("holds one server per id and each address under one server, after any steps", () => {
		assert(
			property(array(operation, { maxLength: 30 }), (steps) => {
				const servers = steps.reduce<KnownServer[]>((list, step) => apply(list, step), []);
				const ids = servers.map((server) => server.id);
				expect(new Set(ids).size).toBe(ids.length);
				const urls = servers.flatMap((server) => server.addresses.map((address) => address.url));
				expect(new Set(urls).size).toBe(urls.length);
			}),
			{ numRuns: 300 },
		);
	});

	it("a server that was added and not removed afterwards is in the list", () => {
		assert(
			property(array(operation, { maxLength: 30 }), integer({ min: 0, max: 2 }), (steps, index) => {
				const id = IDS[index];
				const servers = [...steps, ["add", id, [ORIGINS[index]]] satisfies Step].reduce<
					KnownServer[]
				>((list, step) => apply(list, step), []);
				expect(servers.filter((server) => server.id === id)).toHaveLength(1);
			}),
			{ numRuns: 200 },
		);
	});

	it("never adds an address from an answer over plain HTTP (I2)", () => {
		assert(
			property(
				array(operation, { maxLength: 20 }),
				constantFrom(...IDS),
				constantFrom(...ORIGINS.filter((origin) => origin.startsWith("http://"))),
				array(constantFrom(...ORIGINS), { maxLength: 4 }),
				(steps, id, url, tailnetUrls) => {
					const before = steps.reduce<KnownServer[]>((list, step) => apply(list, step), []);
					const after = recordReached(before, info(id, { tailnetUrls }), url, NOW);
					const urls = (list: KnownServer[]) =>
						list.map((server) => server.addresses.map((address) => address.url));
					expect(urls(after)).toEqual(urls(before));
				},
			),
			{ numRuns: 300 },
		);
	});

	it("saves only https tailnet URLs as reported, whatever the server says", () => {
		assert(
			property(
				constantFrom(...IDS),
				array(constantFrom(...ORIGINS), { maxLength: 4 }),
				(id, tailnetUrls) => {
					const servers = addServer([], info(id, { tailnetUrls }), typed([ORIGINS[2]]), NOW);
					for (const address of servers[0].addresses) {
						if (address.source === "reported")
							expect(address.url.startsWith("https://")).toBe(true);
					}
				},
			),
			{ numRuns: 100 },
		);
	});

	it("loads what it saved", async () => {
		await assert(
			asyncProperty(array(operation, { maxLength: 20 }), async (steps) => {
				const servers = steps.reduce<KnownServer[]>((list, step) => apply(list, step), []);
				const storage = createMemoryStorage();
				await saveServers(storage, servers);
				expect(await loadServers(storage)).toEqual({ kind: "ok", servers });
			}),
			{ numRuns: 100 },
		);
	});

	it("merges two stored entries with one id into one", async () => {
		await assert(
			asyncProperty(record({ index: integer({ min: 0, max: 2 }) }), async ({ index }) => {
				const [server] = addServer([], info(IDS[index]), typed([ORIGINS[0]]), NOW);
				const twin = { ...server, addresses: [{ url: ORIGINS[2], source: "manual" as const }] };
				const storage = createMemoryStorage({
					[SERVERS_KEY]: JSON.stringify({ servers: [server, twin] }),
				});
				const loaded = await loadServers(storage);
				expect(loaded.servers).toHaveLength(1);
				expect(loaded.servers[0].addresses.map((address) => address.url)).toEqual([
					ORIGINS[0],
					ORIGINS[2],
				]);
			}),
			{ numRuns: 3 },
		);
	});
});
