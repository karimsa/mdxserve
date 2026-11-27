import { describe, expect, it } from "@jest/globals";
import type { ServerInfo } from "@mdxserve/shared/server-info";
import { createProbe, type ServerInfoClient } from "../src/servers/probe";

const INFO: ServerInfo = {
	id: "5b0c7a4e-2f1d-4c8b-9a3e-6d2f1b0c7a4e",
	name: "box",
	version: "0.7.0",
	permissions: "full",
	mermaidVersion: "10.9.8",
	treeSchemaVersion: 1,
	tailnetUrls: [],
};

/** A client whose getServerInfo settles the way `answer` says, and that records the origin. */
function clientFrom(answer: (signal: AbortSignal | undefined) => Promise<unknown>) {
	const asked: string[] = [];
	return {
		asked,
		clientFor: (origin: string) => {
			asked.push(origin);
			return {
				getServerInfo: {
					query: (_input: undefined, options?: { signal?: AbortSignal }) => answer(options?.signal),
				},
			} as unknown as ServerInfoClient;
		},
	};
}

describe("createProbe", () => {
	it("returns what the origin says about itself", async () => {
		const { asked, clientFor } = clientFrom(async () => INFO);
		expect(await createProbe(clientFor)("https://box.tail1.ts.net")).toEqual({
			kind: "ok",
			info: INFO,
		});
		expect(asked).toEqual(["https://box.tail1.ts.net"]);
	});

	it("refuses an answer that is not a ServerInfo", async () => {
		const { clientFor } = clientFrom(async () => ({ id: "box" }));
		expect(await createProbe(clientFor)("https://box")).toEqual({
			kind: "failed",
			cause: "it answered, but not as an mdxserve server",
		});
	});

	it("says an older mdxserve has no getServerInfo", async () => {
		const { clientFor } = clientFrom(async () => {
			throw Object.assign(new Error("No procedure found"), { data: { httpStatus: 404 } });
		});
		expect((await createProbe(clientFor)("https://box")).kind).toBe("failed");
		expect(await createProbe(clientFor)("https://box")).toMatchObject({
			cause: expect.stringContaining("has no getServerInfo"),
		});
	});

	it("says a page that is not JSON is not an mdxserve server", async () => {
		const { clientFor } = clientFrom(async () => {
			throw Object.assign(new Error("Unexpected token <"), { cause: new SyntaxError("bad") });
		});
		expect(await createProbe(clientFor)("https://example.com")).toEqual({
			kind: "failed",
			cause: "it answered, but not as an mdxserve server",
		});
	});

	it("gives up when nothing answers in time, and aborts the request", async () => {
		let aborted = false;
		const { clientFor } = clientFrom(
			(signal) =>
				new Promise((_resolve, reject) => {
					signal?.addEventListener("abort", () => {
						aborted = true;
						reject(new Error("aborted"));
					});
				}),
		);
		expect(await createProbe(clientFor, 20)("http://10.255.255.1:4040")).toEqual({
			kind: "failed",
			cause: "no answer within 5 seconds",
		});
		expect(aborted).toBe(true);
	});

	it("reports a connection that failed", async () => {
		const { clientFor } = clientFrom(async () => {
			throw new Error("Network request failed");
		});
		expect(await createProbe(clientFor)("http://192.168.1.10:4040")).toEqual({
			kind: "failed",
			cause: "could not connect (Network request failed)",
		});
	});
});
