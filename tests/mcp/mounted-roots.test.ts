import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, type McpContext } from "../../src/mcp/server.js";
import { mountedRoots } from "../../src/mcp/mounted-roots.js";
import type { Remote } from "../../src/servers/remote.js";
import { SearchService } from "../../src/search/service.js";
import { DocCache } from "../../src/docs/doc-cache.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

let fixtureDir: string;

beforeAll(async () => {
	fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-mounted-roots-"));
	await fs.writeFile(path.join(fixtureDir, "doc.md"), "# Doc\n\nBody.\n", "utf8");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
});

const unavailable = async () => ({ kind: "unavailable" }) as const;

function fakeRemote(overrides: Partial<Remote>): Remote {
	return {
		validateDoc: unavailable,
		searchDocs: unavailable,
		listDocs: unavailable,
		listRoots: unavailable,
		addRoots: unavailable,
		removeRoots: unavailable,
		...overrides,
	};
}

describe("mountedRoots", () => {
	it("reports no-server from the registry alone", async () => {
		const result = await mountedRoots({
			getRoots: () => [{ name: "docs", dir: fixtureDir }],
			serverRunning: () => false,
			remote: fakeRemote({}),
		});
		expect(result.kind).toBe("no-server");
	});

	it("prefers the live server's roots over the registry snapshot", async () => {
		const live = [{ name: "docs", dir: fixtureDir }];
		const result = await mountedRoots({
			getRoots: () => [],
			serverRunning: () => true,
			remote: fakeRemote({ listRoots: async () => ({ kind: "ok", value: { roots: live } }) }),
		});
		expect(result).toEqual({ kind: "ok", roots: live });

		const inverse = await mountedRoots({
			getRoots: () => live,
			serverRunning: () => true,
			remote: fakeRemote({ listRoots: async () => ({ kind: "ok", value: { roots: [] } }) }),
		});
		expect(inverse).toEqual({ kind: "ok", roots: [] });
	});

	it("falls back to the snapshot when the server can't be reached, and surfaces its errors", async () => {
		const snapshot = [{ name: "docs", dir: fixtureDir }];
		const fallback = await mountedRoots({
			getRoots: () => snapshot,
			serverRunning: () => true,
			remote: fakeRemote({}),
		});
		expect(fallback).toEqual({ kind: "ok", roots: snapshot });

		const failed = await mountedRoots({
			getRoots: () => snapshot,
			serverRunning: () => true,
			remote: fakeRemote({ listRoots: async () => ({ kind: "error", message: "boom" }) }),
		});
		expect(failed).toEqual({ kind: "error", message: "boom" });
	});

	it("uses getRoots directly on the HTTP mount (no remote)", async () => {
		const result = await mountedRoots({ getRoots: () => [], remote: undefined });
		expect(result).toEqual({ kind: "ok", roots: [] });
	});
});

describe("stdio tools with an empty registry snapshot but a serving server", () => {
	async function connectedClient(extra: Partial<McpContext>) {
		const docCache = new DocCache();
		const server = createMcpServer({
			getRoots: () => [],
			serverRunning: () => true,
			registry,
			docCache,
			search: new SearchService(docCache),
			...extra,
		});
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		const client = new Client({ name: "test-client", version: "0.0.0" });
		await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
		return { client, server };
	}

	it("list_docs and search_docs ask the server instead of reporting no roots", async () => {
		const live = [{ name: "docs", dir: fixtureDir }];
		const remote = fakeRemote({
			listRoots: async () => ({ kind: "ok", value: { roots: live } }),
			listDocs: async () => ({
				kind: "ok",
				value: [{ name: "docs", dir: fixtureDir, nodes: [] }],
			}),
			searchDocs: async () => ({ kind: "ok", value: [] }),
		});
		const { client, server } = await connectedClient({ remote });
		try {
			const listed = await client.callTool({ name: "list_docs", arguments: {} });
			expect(listed.isError).toBeFalsy();
			expect(listed.structuredContent).toEqual({
				roots: [{ name: "docs", dir: fixtureDir, nodes: [] }],
			});
			const searched = await client.callTool({ name: "search_docs", arguments: { query: "x" } });
			expect(searched.isError).toBeFalsy();
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("validate_doc resolves a relative path against the server's roots", async () => {
		const live = [{ name: "docs", dir: fixtureDir }];
		const seen: string[] = [];
		const remote = fakeRemote({
			listRoots: async () => ({ kind: "ok", value: { roots: live } }),
			validateDoc: async (absPath) => {
				seen.push(absPath);
				return { kind: "unavailable" };
			},
		});
		const { client, server } = await connectedClient({ remote });
		try {
			const result = await client.callTool({ name: "validate_doc", arguments: { path: "doc.md" } });
			expect(result.isError).toBeFalsy();
			expect(seen).toEqual([path.join(fixtureDir, "doc.md")]);
		} finally {
			await client.close();
			await server.close();
		}
	});
});
