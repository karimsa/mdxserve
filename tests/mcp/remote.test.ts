import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, type McpContext } from "../../src/mcp/server.js";
import type { DocTreeRoot } from "../../src/listing/controller.js";
import type { Remote, RemoteOutcome } from "../../src/servers/remote.js";
import type { SearchResult } from "../../src/search/service.js";
import { SearchService } from "../../src/search/service.js";
import { DocCache } from "../../src/docs/doc-cache.js";
import type { ValidationResult } from "../../src/validation/validate.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

let fixtureDir: string;
let otherDir: string;

async function connectedClient(
	getRoots: () => { name: string; dir: string }[] = () => [
		{ name: "docs", dir: fixtureDir },
		{ name: "other", dir: otherDir },
	],
	extra: Partial<McpContext> = {},
) {
	const docCache = new DocCache();
	const server = createMcpServer({
		getRoots,
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

beforeAll(async () => {
	fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-mcp-remote-test-"));
	await fs.writeFile(
		path.join(fixtureDir, "good.md"),
		"# Good doc\n\nSome plain GFM content about widgets and gadgets.\n",
		"utf8",
	);
	await fs.mkdir(path.join(fixtureDir, "sub"));
	await fs.writeFile(
		path.join(fixtureDir, "sub", "nested.md"),
		"# Nested\n\nNested content.\n",
		"utf8",
	);
	// A second root that shares a filename with the first, so a bare
	// "good.md" is ambiguous while "sub/nested.md" is not.
	otherDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-mcp-remote-other-"));
	await fs.writeFile(path.join(otherDir, "good.md"), "# Other\n\nOther root.\n", "utf8");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
	await fs.rm(otherDir, { recursive: true, force: true });
});

describe("validate_doc remote wiring", () => {
	it("returns a remote validate_doc result verbatim, without running local validation", async () => {
		const canned: ValidationResult = {
			ok: false,
			path: "/somewhere/entirely/else.md",
			diagnostics: [{ severity: "error", code: "render-error", message: "from the remote server" }],
			rendered: true,
			hints: [],
		};
		const remote = {
			...unavailableRemote(),
			validateDoc: async (): Promise<RemoteOutcome<ValidationResult>> => ({
				kind: "ok",
				value: canned,
			}),
		};
		const { client, server } = await connectedClient(undefined, { remote });
		try {
			const abs = path.join(fixtureDir, "good.md");
			const result = await client.callTool({ name: "validate_doc", arguments: { path: abs } });
			expect(result.isError).toBeFalsy();
			expect(result.structuredContent).toEqual(canned);
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("from the remote server");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("falls back to local validation when the remote is unavailable", async () => {
		const { client, server } = await connectedClient(undefined, { remote: unavailableRemote() });
		try {
			const abs = path.join(fixtureDir, "good.md");
			const result = await client.callTool({ name: "validate_doc", arguments: { path: abs } });
			expect(result.isError).toBeFalsy();
			expect(result.structuredContent).toMatchObject({ ok: true, path: abs, rendered: false });
		} finally {
			await client.close();
			await server.close();
		}
	});
});

/** Every `Remote` method reporting `unavailable`, for tests that only care about one of them. */
function unavailableRemote(): Remote {
	return {
		validateDoc: async () => ({ kind: "unavailable" }),
		searchDocs: async () => ({ kind: "unavailable" }),
		listDocs: async () => ({ kind: "unavailable" }),
		listRoots: async () => ({ kind: "unavailable" }),
		addRoots: async () => ({ kind: "unavailable" }),
		removeRoots: async () => ({ kind: "unavailable" }),
	};
}

describe("remote search_docs/list_docs wiring", () => {
	it("search_docs prefers a remote ok result over the local index", async () => {
		const canned: SearchResult[] = [
			{
				path: "/remote/only.md",
				label: "remote/only.md",
				title: "Remote only",
				excerpt: "This result only exists on the remote server.",
				terms: ["widgets"],
				score: 5,
			},
		];
		const remote = {
			...unavailableRemote(),
			searchDocs: async (): Promise<RemoteOutcome<SearchResult[]>> => ({
				kind: "ok",
				value: canned,
			}),
		};
		const { client, server } = await connectedClient(undefined, { remote });
		try {
			const result = await client.callTool({
				name: "search_docs",
				arguments: { query: "widgets" },
			});
			expect(result.isError).toBeFalsy();
			expect(result.structuredContent).toEqual({ results: canned });
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("This result only exists on the remote server.");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("search_docs with a remote error returns isError with the message", async () => {
		const remote = {
			...unavailableRemote(),
			searchDocs: async (): Promise<RemoteOutcome<SearchResult[]>> => ({
				kind: "error",
				message: "the remote server exploded",
			}),
		};
		const { client, server } = await connectedClient(undefined, { remote });
		try {
			const result = await client.callTool({
				name: "search_docs",
				arguments: { query: "widgets" },
			});
			expect(result.isError).toBe(true);
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("the remote server exploded");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("search_docs falls back to the local index when the remote is unavailable", async () => {
		const { client, server } = await connectedClient(undefined, { remote: unavailableRemote() });
		try {
			const result = await client.callTool({
				name: "search_docs",
				arguments: { query: "widgets" },
			});
			expect(result.isError).toBeFalsy();
			const structured = result.structuredContent as { results: Array<{ path: string }> };
			expect(structured.results.some((hit) => hit.path.endsWith("good.md"))).toBe(true);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("list_docs prefers a remote ok result over the local walk", async () => {
		const canned: DocTreeRoot[] = [{ name: "remote-root", dir: "/remote/root", nodes: [] }];
		const remote = {
			...unavailableRemote(),
			listDocs: async (): Promise<RemoteOutcome<DocTreeRoot[]>> => ({
				kind: "ok",
				value: canned,
			}),
		};
		const { client, server } = await connectedClient(undefined, { remote });
		try {
			const result = await client.callTool({ name: "list_docs", arguments: {} });
			expect(result.isError).toBeFalsy();
			expect(result.structuredContent).toEqual({ roots: canned });
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("remote-root");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("list_docs with a remote error returns isError with the message", async () => {
		const remote = {
			...unavailableRemote(),
			listDocs: async (): Promise<RemoteOutcome<DocTreeRoot[]>> => ({
				kind: "error",
				message: "the remote directory does not exist",
			}),
		};
		const { client, server } = await connectedClient(undefined, { remote });
		try {
			const result = await client.callTool({ name: "list_docs", arguments: {} });
			expect(result.isError).toBe(true);
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("the remote directory does not exist");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("list_docs falls back to the local walk when the remote is unavailable", async () => {
		const { client, server } = await connectedClient(undefined, { remote: unavailableRemote() });
		try {
			const result = await client.callTool({ name: "list_docs", arguments: {} });
			expect(result.isError).toBeFalsy();
			const structured = result.structuredContent as {
				roots: Array<{ name: string; nodes: unknown[] }>;
			};
			expect(structured.roots.map((rootEntry) => rootEntry.name)).toEqual(["docs", "other"]);
		} finally {
			await client.close();
			await server.close();
		}
	});
});
