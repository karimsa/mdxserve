import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, type McpContext } from "../../src/mcp/server.js";
import type { Remote, RemoteOutcome } from "../../src/servers/remote.js";
import type {
	AddRootsOutput,
	ListRootsOutput,
	RemoveRootsOutput,
} from "../../src/roots/controller.js";
import { RootsService } from "../../src/roots/service.js";
import { DocCache } from "../../src/docs/doc-cache.js";
import { SearchService } from "../../src/search/service.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

let baseDir: string;

beforeAll(async () => {
	baseDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-roots-tools-test-")),
	);
});

afterAll(async () => {
	await fs.rm(baseDir, { recursive: true, force: true });
});

async function connectedClient(extra: Partial<McpContext> = {}) {
	const docCache = new DocCache();
	const server = createMcpServer({
		getRoots: () => [],
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

async function mkTempDir(prefix: string): Promise<string> {
	return fs.realpath(await fs.mkdtemp(path.join(baseDir, prefix)));
}

describe("stdio wiring (Remote proxy)", () => {
	it("add_root proxies to remote.addRoots and returns a structured result", async () => {
		const calls: string[][] = [];
		const remote = {
			...unavailableRemote(),
			addRoots: async (dirs: string[]): Promise<RemoteOutcome<AddRootsOutput>> => {
				calls.push(dirs);
				return { kind: "ok", value: { added: dirs, roots: [{ name: "x", dir: dirs[0] }] } };
			},
		};
		const { client, server } = await connectedClient({ remote });
		try {
			const result = await client.callTool({
				name: "add_root",
				arguments: { path: "/somewhere/x" },
			});
			expect(result.isError).toBeFalsy();
			expect(result.structuredContent).toEqual({
				added: ["/somewhere/x"],
				roots: [{ name: "x", dir: "/somewhere/x" }],
			});
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("Added /somewhere/x");
			expect(calls).toEqual([["/somewhere/x"]]);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("remove_root proxies to remote.removeRoots and returns a structured result", async () => {
		const calls: string[][] = [];
		const remote = {
			...unavailableRemote(),
			removeRoots: async (dirs: string[]): Promise<RemoteOutcome<RemoveRootsOutput>> => {
				calls.push(dirs);
				return { kind: "ok", value: { removed: dirs, roots: [] } };
			},
		};
		const { client, server } = await connectedClient({ remote });
		try {
			const result = await client.callTool({
				name: "remove_root",
				arguments: { path: "/somewhere/x" },
			});
			expect(result.isError).toBeFalsy();
			expect(result.structuredContent).toEqual({ removed: ["/somewhere/x"], roots: [] });
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("Removed /somewhere/x");
			expect(calls).toEqual([["/somewhere/x"]]);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("list_roots proxies to remote.listRoots and returns a structured result", async () => {
		const canned: ListRootsOutput = { roots: [{ name: "docs", dir: "/somewhere/docs" }] };
		const remote = {
			...unavailableRemote(),
			listRoots: async (): Promise<RemoteOutcome<ListRootsOutput>> => ({
				kind: "ok",
				value: canned,
			}),
		};
		const { client, server } = await connectedClient({ remote });
		try {
			const result = await client.callTool({ name: "list_roots", arguments: {} });
			expect(result.isError).toBeFalsy();
			expect(result.structuredContent).toEqual(canned);
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("/somewhere/docs");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("unavailable remote reports NO_SERVER_MESSAGE for all three tools", async () => {
		const remote = unavailableRemote();
		const { client, server } = await connectedClient({ remote });
		try {
			for (const call of [
				{ name: "add_root", arguments: { path: "/somewhere/x" } },
				{ name: "remove_root", arguments: { path: "/somewhere/x" } },
				{ name: "list_roots", arguments: {} },
			]) {
				const result = await client.callTool(call);
				expect(result.isError).toBe(true);
				const text = (result.content as Array<{ text: string }>)[0].text;
				expect(text).toContain("mdxserve serve");
			}
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("a remote error surfaces as isError with the message", async () => {
		const remote = {
			...unavailableRemote(),
			addRoots: async (): Promise<RemoteOutcome<AddRootsOutput>> => ({
				kind: "error",
				message: "nested inside an existing root",
			}),
		};
		const { client, server } = await connectedClient({ remote });
		try {
			const result = await client.callTool({
				name: "add_root",
				arguments: { path: "/somewhere/x" },
			});
			expect(result.isError).toBe(true);
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("nested inside an existing root");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("a relative path to add_root errors without calling the remote", async () => {
		let calls = 0;
		const remote = {
			...unavailableRemote(),
			addRoots: async (): Promise<RemoteOutcome<AddRootsOutput>> => {
				calls++;
				return { kind: "ok", value: { added: [], roots: [] } };
			},
		};
		const { client, server } = await connectedClient({ remote });
		try {
			const result = await client.callTool({
				name: "add_root",
				arguments: { path: "relative/dir" },
			});
			expect(result.isError).toBe(true);
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("absolute");
			expect(calls).toBe(0);
		} finally {
			await client.close();
			await server.close();
		}
	});
});

describe("HTTP wiring (RootsService)", () => {
	it("add_root is refused when allowMutation is false, and the set is unchanged", async () => {
		const dir = await mkTempDir("http-refused-");
		const roots = new RootsService(baseDir);
		const { client, server } = await connectedClient({ roots, allowMutation: false });
		try {
			const result = await client.callTool({ name: "add_root", arguments: { path: dir } });
			expect(result.isError).toBe(true);
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("same-machine");
			expect(roots.list()).toEqual([]);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("add_root mounts the directory when allowMutation is true", async () => {
		const dir = await mkTempDir("http-allowed-");
		const roots = new RootsService(baseDir);
		const { client, server } = await connectedClient({ roots, allowMutation: true });
		try {
			const result = await client.callTool({ name: "add_root", arguments: { path: dir } });
			expect(result.isError).toBeFalsy();
			expect(roots.list().map((info) => info.dir)).toEqual([dir]);
			// Same shape as the stdio path / declared schema: no service `kind` tag.
			expect(result.structuredContent).toEqual({ added: [dir], roots: roots.list() });
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("remove_root unmounts the directory when allowMutation is true", async () => {
		const dir = await mkTempDir("http-remove-");
		const roots = new RootsService(baseDir, os.homedir(), [dir]);
		const { client, server } = await connectedClient({ roots, allowMutation: true });
		try {
			const result = await client.callTool({ name: "remove_root", arguments: { path: dir } });
			expect(result.isError).toBeFalsy();
			expect(roots.list()).toEqual([]);
			expect(result.structuredContent).toEqual({ removed: [dir], roots: [] });
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("list_roots works whether or not mutation is allowed", async () => {
		const dir = await mkTempDir("http-list-");
		const roots = new RootsService(baseDir, os.homedir(), [dir]);
		for (const allowMutation of [true, false]) {
			const { client, server } = await connectedClient({ roots, allowMutation });
			try {
				const result = await client.callTool({ name: "list_roots", arguments: {} });
				expect(result.isError).toBeFalsy();
				const structured = result.structuredContent as { roots: Array<{ dir: string }> };
				expect(structured.roots.map((info) => info.dir)).toEqual([dir]);
			} finally {
				await client.close();
				await server.close();
			}
		}
	});
});

describe("add_root / remove_root property tests", () => {
	const segmentArb = fc.constantFrom("alpha", "beta", "gamma");
	const layoutArb = fc.uniqueArray(
		fc.array(segmentArb, { minLength: 1, maxLength: 2 }).map((segments) => segments.join("/")),
		{ minLength: 1, maxLength: 4, selector: (relative) => relative },
	);

	async function withLayout(
		relatives: string[],
		body: (base: string, absolutes: string[]) => Promise<void>,
	): Promise<void> {
		const base = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-roots-tools-prop-")),
		);
		try {
			const absolutes: string[] = [];
			for (const relative of relatives) {
				const abs = path.join(base, relative);
				await fs.mkdir(abs, { recursive: true });
				absolutes.push(abs);
			}
			await body(base, absolutes);
		} finally {
			await fs.rm(base, { recursive: true, force: true });
		}
	}

	it("adding roots one at a time via add_root matches RootsService.add(all) at once", async () => {
		await fc.assert(
			fc.asyncProperty(layoutArb, async (relatives) => {
				await withLayout(relatives, async (base, absolutes) => {
					const reference = new RootsService(base);
					const referenceResult = await reference.add(absolutes);
					// A layout with one directory nested inside another is a valid
					// conflict RootsService correctly refuses; this property only
					// covers layouts that admit cleanly.
					if (referenceResult.kind !== "ok") return;

					const testService = new RootsService(base);
					const { client, server } = await connectedClient({
						roots: testService,
						allowMutation: true,
					});
					try {
						for (const dirAbs of absolutes) {
							const result = await client.callTool({
								name: "add_root",
								arguments: { path: dirAbs },
							});
							expect(result.isError).toBeFalsy();
						}
						const listResult = await client.callTool({ name: "list_roots", arguments: {} });
						const structured = listResult.structuredContent as { roots: Array<{ dir: string }> };
						expect(structured.roots.map((info) => info.dir).sort()).toEqual(
							[...referenceResult.roots.map((info) => info.dir)].sort(),
						);
					} finally {
						await client.close();
						await server.close();
					}
				});
			}),
			{ numRuns: 15 },
		);
	});

	it("add_root then remove_root of the same dir restores the previous list", async () => {
		await fc.assert(
			fc.asyncProperty(layoutArb, async (relatives) => {
				await withLayout(relatives, async (base, absolutes) => {
					const [target, ...rest] = absolutes;

					// Skip when the target would conflict with the pre-seeded set (e.g.
					// nests inside/contains one of them) — add_root correctly refuses
					// that, and this property isn't about that case.
					const probeResult = await new RootsService(base, os.homedir(), rest).add([target]);
					if (probeResult.kind !== "ok") return;

					const testService = new RootsService(base, os.homedir(), rest);
					const before = testService.list();

					const { client, server } = await connectedClient({
						roots: testService,
						allowMutation: true,
					});
					try {
						const addResult = await client.callTool({
							name: "add_root",
							arguments: { path: target },
						});
						expect(addResult.isError).toBeFalsy();

						const removeResult = await client.callTool({
							name: "remove_root",
							arguments: { path: target },
						});
						expect(removeResult.isError).toBeFalsy();

						expect(testService.list()).toEqual(before);
					} finally {
						await client.close();
						await server.close();
					}
				});
			}),
			{ numRuns: 15 },
		);
	});
});
