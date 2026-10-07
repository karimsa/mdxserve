import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveServerFrom, mountedRoots } from "../../src/servers/mounted-roots.js";
import { ServerRegistry } from "../../src/servers/server-registry.js";
import { fakeLiveServer } from "../helpers/remote.js";

let scratch: string;

beforeAll(async () => {
	scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-mounted-roots-")));
});

afterAll(async () => {
	await fs.rm(scratch, { recursive: true, force: true });
});

describe("mountedRoots", () => {
	it("reports no-server from the registry alone", async () => {
		const result = await mountedRoots(fakeLiveServer({ running: false }));
		expect(result).toEqual({ kind: "no-server" });
	});

	it("prefers the live server's roots over the registry snapshot", async () => {
		const live = [{ name: "docs", dir: "/live" }];
		const result = await mountedRoots(
			fakeLiveServer({
				snapshot: [],
				remote: { listRoots: async () => ({ kind: "ok", value: { roots: live } }) },
			}),
		);
		expect(result).toEqual({ kind: "ok", roots: live });

		const inverse = await mountedRoots(
			fakeLiveServer({
				snapshot: live,
				remote: { listRoots: async () => ({ kind: "ok", value: { roots: [] } }) },
			}),
		);
		expect(inverse).toEqual({ kind: "ok", roots: [] });
	});

	it("falls back to the snapshot when the server cannot be reached", async () => {
		const snapshot = [{ name: "docs", dir: "/snap" }];
		const result = await mountedRoots(fakeLiveServer({ snapshot }));
		expect(result).toEqual({ kind: "ok", roots: snapshot });
	});

	it("surfaces a server error", async () => {
		const result = await mountedRoots(
			fakeLiveServer({
				remote: { listRoots: async () => ({ kind: "error", message: "boom" }) },
			}),
		);
		expect(result).toEqual({ kind: "error", message: "boom" });
	});
});

describe("liveServerFrom", () => {
	it("reads the registry row fresh on every call", () => {
		const registry = new ServerRegistry(path.join(scratch, "servers.db"));
		const live = liveServerFrom(registry);
		expect(live.serverRunning()).toBe(false);
		expect(live.snapshotRoots()).toEqual([]);

		registry.register({ pid: process.pid, port: 4999, host: "127.0.0.1", roots: ["/a/docs"] });
		expect(live.serverRunning()).toBe(true);
		expect(live.snapshotRoots()).toEqual([{ name: "docs", dir: "/a/docs" }]);

		registry.updateRoots(process.pid, ["/a/docs", "/b/other"]);
		expect(live.snapshotRoots().map((rootInfo) => rootInfo.name)).toEqual(["docs", "other"]);

		registry.unregister(process.pid);
		expect(live.serverRunning()).toBe(false);
	});
});
