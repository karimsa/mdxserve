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
	type KnownServer,
} from "../src/servers/store";
import { createMemoryStorage } from "../src/servers/storage";

const NOW = new Date("2026-11-27T12:00:00.000Z");
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
	it("creates a server with the answering address and its tailnet URLs", () => {
		const servers = addServer(
			[],
			info(IDS[0]),
			["http://192.168.1.10:4040", "https://box.tail1.ts.net:4040"],
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
					{ url: "http://192.168.1.10:4040", source: "manual", lastOkAt: NOW.toISOString() },
					{ url: "https://box.tail1.ts.net:4040", source: "manual" },
				],
			},
		]);
	});

	it("appends a second address of a known server to it, keeping its label (C5)", () => {
		const first = renameServer(addServer([], info(IDS[0]), [ORIGINS[0]], NOW), IDS[0], "Studio");
		const servers = addServer(first, info(IDS[0], { name: "box2" }), [ORIGINS[2]], NOW);
		expect(servers).toHaveLength(1);
		expect(servers[0].label).toBe("Studio");
		expect(servers[0].name).toBe("box2");
		expect(servers[0].addresses.map((address) => address.url)).toEqual([ORIGINS[0], ORIGINS[2]]);
	});

	it("moves an address that now answers as another server", () => {
		const first = addServer([], info(IDS[0]), [ORIGINS[0], ORIGINS[2]], NOW);
		const servers = addServer(first, info(IDS[1]), [ORIGINS[2]], NOW);
		expect(servers.map((server) => server.addresses.map((address) => address.url))).toEqual([
			[ORIGINS[0]],
			[ORIGINS[2]],
		]);
	});
});

describe("renameServer and removeServer", () => {
	it("sets and clears the reader's label, and removes by id", () => {
		const servers = addServer([], info(IDS[0]), [ORIGINS[0]], NOW);
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
			...addServer([], info(IDS[0]), [ORIGINS[2]], NOW)[0],
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
		const servers = addServer([], info(IDS[0]), [ORIGINS[0]], NOW);
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
	| readonly ["remove", string];

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
);

function apply(servers: KnownServer[], step: Step): KnownServer[] {
	if (step[0] === "add") return addServer(servers, info(step[1]), step[2], NOW);
	if (step[0] === "rename") return renameServer(servers, step[1], step[2]);
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
				const [server] = addServer([], info(IDS[index]), [ORIGINS[0]], NOW);
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
