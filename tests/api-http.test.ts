import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import type { AppRouter } from "../src/api/router.js";
import { makeCtx, startTestServer } from "./helpers/server.js";
import type { RenderOutcome } from "../src/render.js";
import { fixtureRegistry as registry } from "./fixtures/registry.js";

let fixtureDir: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-api-http-")));
	await fs.writeFile(path.join(fixtureDir, "good.md"), "# Good doc\n\nHello.\n", "utf8");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
});

let closers: (() => void)[] = [];

afterEach(() => {
	for (const close of closers) close();
	closers = [];
});

async function startWith(overrides: Parameters<typeof makeCtx>[2] = {}) {
	const ctx = makeCtx(fixtureDir, registry, overrides);
	const { server, base } = await startTestServer(ctx);
	closers.push(() => server.close());
	return { base };
}

describe("GET /__mdxserve/trpc/*", () => {
	it("getDocTree returns a 200 envelope with roots", async () => {
		const { base } = await startWith();
		const res = await fetch(`${base}/__mdxserve/trpc/getDocTree?input=%7B%7D`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { result: { data: { roots: unknown[] } } };
		expect(body.result.data.roots).toBeInstanceOf(Array);
		expect(body.result.data.roots).toHaveLength(1);
	});

	it("no longer serves /__mdxserve/api/tree as a 200 JSON response", async () => {
		const { base } = await startWith();
		const res = await fetch(`${base}/__mdxserve/api/tree`);
		const contentType = res.headers.get("content-type") ?? "";
		const isOldJsonOk = res.status === 200 && contentType.includes("application/json");
		expect(isOldJsonOk).toBe(false);
	});

	it("405s a GET on a mutation (moveDocsToTrash)", async () => {
		const { base } = await startWith();
		const res = await fetch(`${base}/__mdxserve/trpc/moveDocsToTrash?input=%7B%7D`);
		expect(res.status).toBe(405);
	});
});

describe("POST /__mdxserve/trpc/*", () => {
	it("415s a text/plain content type", async () => {
		const { base } = await startWith();
		const res = await fetch(`${base}/__mdxserve/trpc/validateDoc`, {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: JSON.stringify({ path: path.join(fixtureDir, "good.md") }),
		});
		expect(res.status).toBe(415);
	});

	it("415s a smuggled application/json inside a text/plain parameter", async () => {
		const { base } = await startWith();
		const res = await fetch(`${base}/__mdxserve/trpc/validateDoc`, {
			method: "POST",
			headers: { "Content-Type": "text/plain;x=application/json" },
			body: JSON.stringify({ path: path.join(fixtureDir, "good.md") }),
		});
		expect(res.status).toBe(415);
	});

	it("413s an oversized moveDocsToTrash body", async () => {
		const { base } = await startWith();
		// Well past the adapter's 320 KB maxBodySize (sized for saveDocSection).
		const paths = Array.from({ length: 8000 }, (_unused, index) => `/x/${"p".repeat(50)}${index}`);
		const res = await fetch(`${base}/__mdxserve/trpc/moveDocsToTrash`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ paths }),
		});
		expect(res.status).toBe(413);
	});

	it("400s an oversized validateDoc path (over the 4096-char input bound)", async () => {
		const { base } = await startWith();
		const res = await fetch(`${base}/__mdxserve/trpc/validateDoc`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ path: "x".repeat(8 * 1024) }),
		});
		expect(res.status).toBe(400);
	});
});

describe("typed tRPC client round trip", () => {
	function makeClient(base: string) {
		return createTRPCClient<AppRouter>({ links: [httpLink({ url: `${base}/__mdxserve/trpc` })] });
	}

	it("validateDoc.mutate runs the configured render stub and returns a result", async () => {
		const render = vi.fn(async (): Promise<RenderOutcome> => ({ ok: true }));
		const { base } = await startWith({
			mcp: { getRoots: () => [{ name: "docs", dir: fixtureDir }], registry, render },
		});
		const client = makeClient(base);
		const result = await client.validateDoc.mutate({ path: path.join(fixtureDir, "good.md") });
		expect(result.ok).toBe(true);
		expect(result.rendered).toBe(true);
		expect(render).toHaveBeenCalledOnce();
	});

	it("validateDoc.mutate rejects with a NOT_FOUND TRPCClientError for a path outside every root", async () => {
		const { base } = await startWith();
		const client = makeClient(base);
		try {
			await client.validateDoc.mutate({ path: "/etc/passwd" });
			throw new Error("expected validateDoc.mutate to reject");
		} catch (error) {
			expect(error).toBeInstanceOf(TRPCClientError);
			const clientError = error as TRPCClientError<AppRouter>;
			expect(clientError.data?.code).toBe("NOT_FOUND");
			expect(clientError.data?.httpStatus).toBe(404);
		}
	});
});

describe("same-origin guard on mutations", () => {
	function makeClient(base: string, origin?: string) {
		return createTRPCClient<AppRouter>({
			links: [
				httpLink({
					url: `${base}/__mdxserve/trpc`,
					headers: origin === undefined ? undefined : { origin },
				}),
			],
		});
	}

	it("403s a mutation whose Origin does not match the Host it arrived on", async () => {
		const { base } = await startWith();
		const client = makeClient(base, "http://evil.example");
		try {
			await client.validateDoc.mutate({ path: path.join(fixtureDir, "good.md") });
			throw new Error("expected validateDoc.mutate to reject");
		} catch (error) {
			expect(error).toBeInstanceOf(TRPCClientError);
			const clientError = error as TRPCClientError<AppRouter>;
			expect(clientError.data?.code).toBe("FORBIDDEN");
			expect(clientError.data?.httpStatus).toBe(403);
		}
	});

	it("accepts a mutation whose Origin matches the Host (what a browser sends same-origin)", async () => {
		const { base } = await startWith();
		const client = makeClient(base, base);
		const result = await client.validateDoc.mutate({ path: path.join(fixtureDir, "good.md") });
		expect(result.ok).toBe(true);
	});

	it("leaves queries reachable cross-origin (nothing readable without CORS headers anyway)", async () => {
		const { base } = await startWith();
		const client = makeClient(base, "http://evil.example");
		const tree = await client.getDocTree.query({});
		expect(tree.roots).toHaveLength(1);
	});
});
