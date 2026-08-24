import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, type McpContext } from "../src/mcp.js";
import { createRemote, serverBaseUrl } from "../src/remote.js";
import { computeRootInfos, pruneNestedRoots } from "../src/roots.js";
import type { ServerRecord } from "../src/server-registry.js";
import type { RenderOutcome } from "../src/render.js";
import { makeCtx, startTestServer } from "./helpers/server.js";
import { fixtureRegistry as registry } from "./fixtures/registry.js";

describe("serverBaseUrl", () => {
	it("normalizes a wildcard IPv4 bind address to loopback", () => {
		expect(serverBaseUrl({ host: "0.0.0.0", port: 4040 })).toBe("http://127.0.0.1:4040");
	});

	it("normalizes a wildcard IPv6 bind address to loopback", () => {
		expect(serverBaseUrl({ host: "::", port: 4040 })).toBe("http://127.0.0.1:4040");
	});

	it("brackets a concrete IPv6 host", () => {
		expect(serverBaseUrl({ host: "::1", port: 4040 })).toBe("http://[::1]:4040");
	});

	it("passes a concrete LAN host through unchanged", () => {
		expect(serverBaseUrl({ host: "192.168.1.10", port: 4040 })).toBe("http://192.168.1.10:4040");
	});

	it("property: the base URL parses and its port round-trips", () => {
		const hostArb = fc.constantFrom(
			"0.0.0.0",
			"::",
			"::1",
			"127.0.0.1",
			"192.168.1.10",
			"docs.internal",
		);
		const portArb = fc.integer({ min: 1, max: 65535 });
		fc.assert(
			fc.property(hostArb, portArb, (host, port) => {
				const base = serverBaseUrl({ host, port });
				const url = new URL(base);
				expect(url.port).toBe(String(port));
			}),
		);
	});
});

async function connectedClient(ctx: McpContext) {
	const server = createMcpServer(ctx);
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "test-client", version: "0.0.0" });
	await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
	return { client, server };
}

/** A port nothing is listening on, to simulate a registry row surviving a server crash. */
async function unusedPort(): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const probe = http.createServer();
		probe.on("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			const port = address && typeof address === "object" ? address.port : null;
			probe.close((closeError) => {
				if (closeError) {
					reject(closeError);
					return;
				}
				if (port === null) {
					reject(new Error("failed to allocate a port"));
					return;
				}
				resolve(port);
			});
		});
	});
}

describe("createRemote integration (two real servers)", () => {
	let rootA: string;
	let rootAShared: string;
	let rootB: string;
	let rootC: string;
	let serverA: http.Server;
	let serverB: http.Server;
	let portA: number;
	let portB: number;
	let deadPort: number;

	beforeAll(async () => {
		const workDir = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-remote-test-")),
		);
		rootA = path.join(workDir, "root-a");
		rootB = path.join(workDir, "root-b");
		rootC = path.join(workDir, "root-c");
		rootAShared = path.join(rootA, "shared");
		await fs.mkdir(rootAShared, { recursive: true });
		await fs.mkdir(rootB, { recursive: true });
		await fs.mkdir(rootC, { recursive: true });

		await fs.writeFile(
			path.join(rootA, "alpha.md"),
			"# Alpha\n\nAlpha doc about gizmo widgets.\n",
			"utf8",
		);
		// Deliberately owned by BOTH servers: server A indexes it as part of
		// rootA's tree, and server B serves rootAShared as its own separate
		// root — so a search for a word in this doc hits it twice, from two
		// independent servers, over the same absolute path.
		await fs.writeFile(
			path.join(rootAShared, "shared-doc.md"),
			"# Shared\n\nShared doc about generic widgets.\n",
			"utf8",
		);
		await fs.writeFile(
			path.join(rootB, "beta.md"),
			"# Beta\n\nBeta doc about sprocket widgets.\n",
			"utf8",
		);
		await fs.writeFile(path.join(rootC, "gamma.md"), "# Gamma\n\nPlain gamma content.\n", "utf8");

		const ctxA = makeCtx(rootA, registry, {
			roots: [rootA],
			rootInfos: [{ name: "server-a", dir: rootA }],
			mcp: {
				getRoots: () => [{ name: "server-a", dir: rootA }],
				registry,
				// Simulates a real, successfully-rendering Vite dev server, so
				// validate_doc through this server reports rendered: true.
				render: async (): Promise<RenderOutcome> => ({ ok: true }),
			},
		});
		const ctxB = makeCtx(rootB, registry, {
			roots: [rootAShared, rootB],
			rootInfos: [
				{ name: "shared", dir: rootAShared },
				{ name: "server-b", dir: rootB },
			],
			mcp: {
				getRoots: () => [
					{ name: "shared", dir: rootAShared },
					{ name: "server-b", dir: rootB },
				],
				registry,
			},
		});

		const startedA = await startTestServer(ctxA);
		const startedB = await startTestServer(ctxB);
		serverA = startedA.server;
		serverB = startedB.server;
		portA = Number(new URL(startedA.base).port);
		portB = Number(new URL(startedB.base).port);
		deadPort = await unusedPort();
	});

	afterAll(async () => {
		serverA.close();
		serverB.close();
	});

	// The test connects to 127.0.0.1, which is loopback on both ends, so
	// handleRequest's isLoopback gate lets validate_doc's render step run —
	// same as a real `mdxserve serve` answering a same-machine caller.
	function fakeListServers(): ServerRecord[] {
		return [
			{ pid: process.pid, host: "127.0.0.1", port: portA, roots: [rootA], startedAt: Date.now() },
			{
				pid: process.pid,
				host: "127.0.0.1",
				port: portB,
				roots: [rootAShared, rootB],
				startedAt: Date.now(),
			},
			// A row surviving a crash: its process never got to unregister
			// itself, so it's still in the registry, but nothing answers here.
			{
				pid: process.pid,
				host: "127.0.0.1",
				port: deadPort,
				roots: [rootC],
				startedAt: Date.now(),
			},
		];
	}

	function bridgeContext(): McpContext {
		return {
			getRoots: () => computeRootInfos(pruneNestedRoots([rootA, rootAShared, rootB, rootC])),
			registry,
			remote: createRemote(fakeListServers),
		};
	}

	it("validate_doc returns the owning server's rendered:true", async () => {
		const { client, server } = await connectedClient(bridgeContext());
		try {
			const abs = path.join(rootA, "alpha.md");
			const result = await client.callTool({ name: "validate_doc", arguments: { path: abs } });
			expect(result.isError).toBeFalsy();
			expect(result.structuredContent).toMatchObject({ ok: true, path: abs, rendered: true });
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("falls back to local static validation when the owning registry row is dead", async () => {
		const { client, server } = await connectedClient(bridgeContext());
		try {
			const abs = path.join(rootC, "gamma.md");
			const result = await client.callTool({ name: "validate_doc", arguments: { path: abs } });
			expect(result.isError).toBeFalsy();
			expect(result.structuredContent).toMatchObject({ ok: true, path: abs, rendered: false });
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("search_docs merges results across both servers and dedupes by absolute path", async () => {
		const { client, server } = await connectedClient(bridgeContext());
		try {
			const result = await client.callTool({
				name: "search_docs",
				arguments: { query: "widgets" },
			});
			expect(result.isError).toBeFalsy();
			const structured = result.structuredContent as { results: Array<{ path: string }> };
			const paths = structured.results.map((hit) => hit.path);
			expect(new Set(paths).size).toBe(paths.length);
			expect(paths).toContain(path.join(rootA, "alpha.md"));
			expect(paths).toContain(path.join(rootAShared, "shared-doc.md"));
			expect(paths).toContain(path.join(rootB, "beta.md"));
			expect(paths).toHaveLength(3);
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("list_docs with no path lists the outer root exactly once", async () => {
		const { client, server } = await connectedClient(bridgeContext());
		try {
			const result = await client.callTool({ name: "list_docs", arguments: {} });
			expect(result.isError).toBeFalsy();
			const structured = result.structuredContent as {
				roots: Array<{ name: string; dir: string; nodes: unknown[] }>;
			};
			expect(structured.roots.map((rootEntry) => rootEntry.dir)).toEqual([rootA, rootB]);
			const rootAEntry = structured.roots.find((rootEntry) => rootEntry.dir === rootA);
			expect(JSON.stringify(rootAEntry?.nodes)).toContain("shared-doc.md");
		} finally {
			await client.close();
			await server.close();
		}
	});
});

describe("createRemote fan-out with a server that answers with a tRPC error", () => {
	let healthyRoot: string;
	let brokenRoot: string;
	let healthyServer: http.Server;
	let healthyPort: number;
	let brokenServer: http.Server;
	let brokenPort: number;

	beforeAll(async () => {
		healthyRoot = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-fanout-ok-")),
		);
		brokenRoot = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-fanout-bad-")),
		);
		await fs.writeFile(
			path.join(healthyRoot, "good.md"),
			"# Good\n\nwidgets everywhere.\n",
			"utf8",
		);

		const started = await startTestServer(makeCtx(healthyRoot, registry));
		healthyServer = started.server;
		healthyPort = Number(new URL(started.base).port);

		// A live server whose index has broken: every procedure call comes back
		// as a tRPC INTERNAL_SERVER_ERROR envelope (what the real adapter emits
		// when a resolver throws), so the client sees a TRPCClientError with a
		// `data.code` — as opposed to the dead-port case, which never connects.
		brokenServer = http.createServer((_req, res) => {
			res.statusCode = 500;
			res.setHeader("Content-Type", "application/json");
			res.end(
				JSON.stringify({
					error: {
						message: "search index exploded",
						code: -32603,
						data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
					},
				}),
			);
		});
		await new Promise<void>((resolve) => brokenServer.listen(0, "127.0.0.1", resolve));
		const address = brokenServer.address();
		brokenPort = address && typeof address === "object" ? address.port : 0;
	});

	afterAll(async () => {
		healthyServer.close();
		brokenServer.close();
		await fs.rm(healthyRoot, { recursive: true, force: true });
		await fs.rm(brokenRoot, { recursive: true, force: true });
	});

	function fakeListServers(): ServerRecord[] {
		return [
			{
				pid: process.pid,
				host: "127.0.0.1",
				port: healthyPort,
				roots: [healthyRoot],
				startedAt: 1,
			},
			{ pid: process.pid, host: "127.0.0.1", port: brokenPort, roots: [brokenRoot], startedAt: 2 },
		];
	}

	function bridgeContext(): McpContext {
		return {
			getRoots: () => computeRootInfos([healthyRoot, brokenRoot]),
			registry,
			remote: createRemote(fakeListServers),
		};
	}

	it("search_docs surfaces the broken server's error instead of a partial result", async () => {
		const { client, server } = await connectedClient(bridgeContext());
		try {
			const result = await client.callTool({
				name: "search_docs",
				arguments: { query: "widgets" },
			});
			expect(result.isError).toBe(true);
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("search index exploded");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("list_docs with no path surfaces the broken server's error instead of an incomplete tree", async () => {
		const { client, server } = await connectedClient(bridgeContext());
		try {
			const result = await client.callTool({ name: "list_docs", arguments: {} });
			expect(result.isError).toBe(true);
			const text = (result.content as Array<{ text: string }>)[0].text;
			expect(text).toContain("search index exploded");
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("list_docs for a path owned by the healthy server still succeeds", async () => {
		const { client, server } = await connectedClient(bridgeContext());
		try {
			const result = await client.callTool({ name: "list_docs", arguments: { path: healthyRoot } });
			expect(result.isError).toBeFalsy();
			const roots = (result.structuredContent as { roots: { dir: string }[] }).roots;
			expect(roots.map((root) => root.dir)).toEqual([healthyRoot]);
		} finally {
			await client.close();
			await server.close();
		}
	});
});
