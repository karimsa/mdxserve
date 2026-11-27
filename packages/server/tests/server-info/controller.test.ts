import { describe, expect, it } from "vitest";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import { DOCUMENT_SCHEMA_VERSION } from "../../src/document/schema.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext } from "../helpers/context.js";
import { TEST_IDENTITY, testServerInfo } from "../helpers/server-info.js";

const createCaller = createCallerFactory(appRouter);

describe("getServerInfo", () => {
	it("returns the server's identity and its tailnet addresses", async () => {
		const caller = createCaller(
			makeContext("/nonexistent-root", registry, {
				serverInfo: testServerInfo({}, ["box.tail1.ts.net:4040"]),
			}),
		);
		expect(await caller.getServerInfo()).toEqual({
			...TEST_IDENTITY,
			treeSchemaVersion: DOCUMENT_SCHEMA_VERSION,
			tailnetUrls: ["https://box.tail1.ts.net:4040"],
		});
	});

	it("answers a restricted server, a remote caller and a request with another Origin", async () => {
		const caller = createCaller(
			makeContext("/nonexistent-root", registry, {
				permissions: "restricted",
				isLoopback: false,
				origin: "https://elsewhere.example",
				host: "box.local:4040",
				serverInfo: testServerInfo({ permissions: "restricted" }),
			}),
		);
		expect((await caller.getServerInfo()).permissions).toBe("restricted");
	});

	it("rejects an answer that breaks the output schema instead of sending it", async () => {
		const caller = createCaller(
			makeContext("/nonexistent-root", registry, {
				serverInfo: testServerInfo({ id: "not-a-uuid" }),
			}),
		);
		await expect(caller.getServerInfo()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
	});
});
