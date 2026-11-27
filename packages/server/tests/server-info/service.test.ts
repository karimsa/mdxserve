import { describe, expect, it } from "vitest";
import { serverInfoSchema } from "@mdxserve/shared/server-info";
import { DOCUMENT_SCHEMA_VERSION } from "../../src/document/schema.js";
import { ServerInfoService } from "../../src/server-info/service.js";
import { TEST_IDENTITY, testServerInfo } from "../helpers/server-info.js";

describe("ServerInfoService.info", () => {
	it("reports the identity, the tree schema version and no tailnet address without a source", () => {
		expect(testServerInfo().info()).toEqual({
			kind: "ok",
			info: {
				...TEST_IDENTITY,
				treeSchemaVersion: DOCUMENT_SCHEMA_VERSION,
				tailnetUrls: [],
			},
		});
	});

	it("turns each tailnet Host into an https origin, sorted", () => {
		const service = testServerInfo({}, ["box.tail1.ts.net:4040", "alpha.tail1.ts.net"]);
		expect(service.info().info.tailnetUrls).toEqual([
			"https://alpha.tail1.ts.net",
			"https://box.tail1.ts.net:4040",
		]);
	});

	it("reads the tailnet hosts on every call, so a detection that finishes later shows up", () => {
		let hosts: ReadonlySet<string> = new Set();
		const late = new ServerInfoService(TEST_IDENTITY, { current: () => hosts });
		expect(late.info().info.tailnetUrls).toEqual([]);
		hosts = new Set(["box.tail1.ts.net"]);
		expect(late.info().info.tailnetUrls).toEqual(["https://box.tail1.ts.net"]);
	});

	it("reports at most eight tailnet addresses, and the answer passes the shared schema", () => {
		const hosts = Array.from({ length: 12 }, (_, index) => `box.tail1.ts.net:${8000 + index}`);
		const { info } = testServerInfo({ permissions: "restricted" }, hosts).info();
		expect(info.tailnetUrls).toHaveLength(8);
		expect(serverInfoSchema.parse(info)).toEqual(info);
	});
});
