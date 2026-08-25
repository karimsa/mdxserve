import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { TRPCClientError } from "@trpc/client";
import { RemoteClient, serverBaseUrl, toOutcome } from "../../src/servers/remote.js";
import type { ServerRecord } from "../../src/servers/server-registry.js";
import { makeRequestContext, startTestServer } from "../helpers/http.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

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

describe("RemoteClient (one real server)", () => {
	let fixtureDir: string;
	let secondDir: string;
	let realServer: http.Server;
	let port: number;
	let deadPort: number;

	beforeAll(async () => {
		fixtureDir = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-remote-test-")),
		);
		secondDir = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-remote-second-")),
		);
		await fs.writeFile(
			path.join(fixtureDir, "alpha.md"),
			"# Alpha\n\nAlpha doc about gizmo widgets.\n",
			"utf8",
		);
		await fs.mkdir(path.join(fixtureDir, "sub"));
		await fs.writeFile(
			path.join(fixtureDir, "sub", "nested.md"),
			"# Nested\n\nNested content.\n",
			"utf8",
		);

		const started = await startTestServer(makeRequestContext(fixtureDir, registry));
		realServer = started.server;
		port = Number(new URL(started.base).port);
		deadPort = await unusedPort();
	});

	afterAll(async () => {
		realServer.close();
		await fs.rm(fixtureDir, { recursive: true, force: true });
		await fs.rm(secondDir, { recursive: true, force: true });
	});

	/** The test server binds to 127.0.0.1, which is loopback on both ends, so
	 * `handleRequest`'s isLoopback gate lets validate_doc's render step (and
	 * addRoots/removeRoots) run — same as a real `mdxserve serve` answering a
	 * same-machine caller. */
	function currentRecord(): ServerRecord {
		return {
			pid: process.pid,
			host: "127.0.0.1",
			port,
			roots: [fixtureDir],
			startedAt: Date.now(),
		};
	}

	it("validateDoc: ok", async () => {
		const client = new RemoteClient(currentRecord);
		const outcome = await client.validateDoc(path.join(fixtureDir, "alpha.md"));
		expect(outcome.kind).toBe("ok");
		if (outcome.kind === "ok") {
			expect(outcome.value).toMatchObject({ ok: true, path: path.join(fixtureDir, "alpha.md") });
		}
	});

	it("searchDocs: ok", async () => {
		const client = new RemoteClient(currentRecord);
		const outcome = await client.searchDocs("widgets");
		expect(outcome.kind).toBe("ok");
		if (outcome.kind === "ok") {
			expect(outcome.value.some((hit) => hit.path.endsWith("alpha.md"))).toBe(true);
		}
	});

	it("listDocs without a path: ok, lists the outer root", async () => {
		const client = new RemoteClient(currentRecord);
		const outcome = await client.listDocs(undefined, 8);
		expect(outcome.kind).toBe("ok");
		if (outcome.kind === "ok") {
			expect(outcome.value.map((rootEntry) => rootEntry.dir)).toEqual([fixtureDir]);
		}
	});

	it("listDocs with a path: ok, lists that subtree", async () => {
		const client = new RemoteClient(currentRecord);
		const outcome = await client.listDocs(path.join(fixtureDir, "sub"), 8);
		expect(outcome.kind).toBe("ok");
		if (outcome.kind === "ok") {
			expect(JSON.stringify(outcome.value)).toContain("nested.md");
		}
	});

	it("listRoots: ok, with the fixture root", async () => {
		const client = new RemoteClient(currentRecord);
		const outcome = await client.listRoots();
		expect(outcome.kind).toBe("ok");
		if (outcome.kind === "ok") {
			expect(outcome.value.roots.map((rootInfo) => rootInfo.dir)).toEqual([fixtureDir]);
		}
	});

	it("addRoots then removeRoots round trip a second directory", async () => {
		const client = new RemoteClient(currentRecord);

		const added = await client.addRoots([secondDir]);
		expect(added.kind).toBe("ok");
		if (added.kind === "ok") {
			expect(added.value.added).toEqual([secondDir]);
			expect(added.value.roots.map((rootInfo) => rootInfo.dir)).toContain(secondDir);
		}

		const listedAfterAdd = await client.listRoots();
		expect(listedAfterAdd.kind).toBe("ok");
		if (listedAfterAdd.kind === "ok") {
			expect(listedAfterAdd.value.roots.map((rootInfo) => rootInfo.dir)).toContain(secondDir);
		}

		const removed = await client.removeRoots([secondDir]);
		expect(removed.kind).toBe("ok");
		if (removed.kind === "ok") {
			expect(removed.value.removed).toEqual([secondDir]);
			expect(removed.value.roots.map((rootInfo) => rootInfo.dir)).not.toContain(secondDir);
		}

		const listedAfterRemove = await client.listRoots();
		expect(listedAfterRemove.kind).toBe("ok");
		if (listedAfterRemove.kind === "ok") {
			expect(listedAfterRemove.value.roots.map((rootInfo) => rootInfo.dir)).not.toContain(
				secondDir,
			);
		}
	});

	it("getServer undefined: unavailable for all six, without connecting", async () => {
		const client = new RemoteClient(() => undefined);
		await expect(client.validateDoc("/x.md")).resolves.toEqual({ kind: "unavailable" });
		await expect(client.searchDocs("x")).resolves.toEqual({ kind: "unavailable" });
		await expect(client.listDocs(undefined, 8)).resolves.toEqual({ kind: "unavailable" });
		await expect(client.listRoots()).resolves.toEqual({ kind: "unavailable" });
		await expect(client.addRoots(["/x"])).resolves.toEqual({ kind: "unavailable" });
		await expect(client.removeRoots(["/x"])).resolves.toEqual({ kind: "unavailable" });
	});

	it("a dead port reports unavailable", async () => {
		const client = new RemoteClient(() => ({
			pid: process.pid,
			host: "127.0.0.1",
			port: deadPort,
			roots: [],
			startedAt: Date.now(),
		}));
		const outcome = await client.validateDoc(path.join(fixtureDir, "alpha.md"));
		expect(outcome).toEqual({ kind: "unavailable" });
	});

	it("a port change between calls reaches the new server", async () => {
		let servedPort = deadPort;
		const client = new RemoteClient(() => ({
			pid: process.pid,
			host: "127.0.0.1",
			port: servedPort,
			roots: [fixtureDir],
			startedAt: Date.now(),
		}));

		const beforeSwitch = await client.listRoots();
		expect(beforeSwitch).toEqual({ kind: "unavailable" });

		servedPort = port;
		const afterSwitch = await client.listRoots();
		expect(afterSwitch.kind).toBe("ok");
	});
});

describe("RemoteClient against a server answering with a tRPC error", () => {
	let brokenServer: http.Server;
	let brokenPort: number;

	beforeAll(async () => {
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

	afterAll(() => {
		brokenServer.close();
	});

	function record(): ServerRecord {
		return {
			pid: process.pid,
			host: "127.0.0.1",
			port: brokenPort,
			roots: [],
			startedAt: Date.now(),
		};
	}

	it("searchDocs surfaces the server's error message", async () => {
		const client = new RemoteClient(record);
		const outcome = await client.searchDocs("widgets");
		expect(outcome).toEqual({ kind: "error", message: "search index exploded" });
	});

	it("listRoots surfaces the server's error message", async () => {
		const client = new RemoteClient(record);
		const outcome = await client.listRoots();
		expect(outcome).toEqual({ kind: "error", message: "search index exploded" });
	});
});

describe("toOutcome (property)", () => {
	it("any TRPCClientError with a data.code becomes an error carrying the message", () => {
		fc.assert(
			fc.property(fc.string(), fc.string({ minLength: 1 }), (message, code) => {
				const error = new TRPCClientError(message, {
					result: {
						error: { code: -32603, message, data: { code, httpStatus: 500 } },
					},
				});
				expect(toOutcome(error)).toEqual({ kind: "error", message });
			}),
		);
	});

	it("any other value becomes unavailable", () => {
		const notReportableArb = fc.oneof(
			fc.anything(),
			fc.string().map((message) => new Error(message)),
			fc.string().map((message) => new TRPCClientError(message)),
		);
		fc.assert(
			fc.property(notReportableArb, (value) => {
				expect(toOutcome(value)).toEqual({ kind: "unavailable" });
			}),
		);
	});
});
