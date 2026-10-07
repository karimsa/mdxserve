import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTRPCClient, httpLink, TRPCClientError } from "@trpc/client";
import type { ViteDevServer } from "vite";
import type { AppRouter } from "../../src/api/router.js";
import { renderShell } from "../../src/http/shell.js";
import { makeRequestContext, startTestServer } from "../helpers/http.js";
import type { RenderOutcome } from "../../src/rendering/protocol.js";
import { DocCache } from "../../src/docs/doc-cache.js";
import { SearchService } from "../../src/search/service.js";
import { RootsService } from "../../src/roots/service.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

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

async function startWith(overrides: Parameters<typeof makeRequestContext>[2] = {}) {
	const ctx = makeRequestContext(fixtureDir, registry, overrides);
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
		const docCache = new DocCache();
		const { base } = await startWith({
			render,
			docCache,
			search: new SearchService(docCache),
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

// The default fake `vite` from makeRequestContext only stubs `middlewares`
// (enough for the trpc/api-focused tests above); the HTML-rendering routes
// exercised below also call `vite.transformIndexHtml`.
function htmlVite(): ViteDevServer {
	return {
		middlewares: (_req: unknown, res: http.ServerResponse, next: () => void) => next(),
		transformIndexHtml: async (_url: string, html: string) => html,
	} as unknown as ViteDevServer;
}

describe("root count affects / and doc routing", () => {
	it('GET / is a 200 home page with data-root-count="0" when nothing is mounted', async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), []);
		const { base } = await startWith({ roots, vite: htmlVite() });
		const res = await fetch(`${base}/`);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('data-root-count="0"');
	});

	it("GET / is a 200 home page for two mounted roots", async () => {
		const other = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-api-http-other-")),
		);
		try {
			const roots = new RootsService(fixtureDir, os.homedir(), [fixtureDir, other]);
			const { base } = await startWith({ roots, vite: htmlVite() });
			const res = await fetch(`${base}/`);
			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain('data-root-count="2"');
		} finally {
			await fs.rm(other, { recursive: true, force: true });
		}
	});

	it("GET / redirects (302) into the single mounted root", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), [fixtureDir]);
		const { base } = await startWith({ roots, vite: htmlVite() });
		const res = await fetch(`${base}/`, { redirect: "manual" });
		expect(res.status).toBe(302);
	});

	it("404s a doc path when nothing is mounted", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), []);
		const { base } = await startWith({ roots, vite: htmlVite() });
		const res = await fetch(`${base}${encodeURI(path.join(fixtureDir, "good.md"))}`, {
			headers: { Accept: "text/html" },
		});
		expect(res.status).toBe(404);
	});

	it("a root added to the shared RootsService after startup is visible to getDocTree", async () => {
		const roots = new RootsService(fixtureDir, os.homedir(), []);
		const { base } = await startWith({ roots });
		const client = createTRPCClient<AppRouter>({
			links: [httpLink({ url: `${base}/__mdxserve/trpc` })],
		});
		expect((await client.getDocTree.query({})).roots).toHaveLength(0);

		const added = await roots.add([fixtureDir]);
		expect(added.kind).toBe("ok");

		const tree = await client.getDocTree.query({});
		expect(tree.roots).toHaveLength(1);
	});
});

describe("data-same-machine on the shell", () => {
	it('renderShell(route) defaults to data-same-machine="0"', () => {
		const html = renderShell({ kind: "notfound", path: "/x" });
		expect(html).toContain('data-same-machine="0"');
	});

	it('a loopback request for a doc URL gets a shell with data-same-machine="1"', async () => {
		const { base } = await startWith({ vite: htmlVite() });
		const res = await fetch(`${base}${encodeURI(path.join(fixtureDir, "good.md"))}`, {
			headers: { Accept: "text/html" },
		});
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain('data-same-machine="1"');
	});
});

describe("DNS-rebinding guard on same-machine privileges", () => {
	function request(
		base: string,
		pathname: string,
		host: string,
		body: string,
	): Promise<{ status: number; text: string }> {
		const url = new URL(base);
		return new Promise((resolve, reject) => {
			const req = http.request(
				{
					hostname: url.hostname,
					port: url.port,
					path: pathname,
					method: "POST",
					headers: {
						host,
						"content-type": "application/json",
						"content-length": Buffer.byteLength(body),
					},
				},
				(res) => {
					let text = "";
					res.setEncoding("utf8");
					res.on("data", (chunk: string) => {
						text += chunk;
					});
					res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
				},
			);
			req.on("error", reject);
			req.end(body);
		});
	}

	it("addRoots is FORBIDDEN when a loopback request carries a foreign Host", async () => {
		const { base } = await startWith();
		const port = new URL(base).port;
		const body = JSON.stringify({ dirs: [fixtureDir] });
		const rebinding = await request(
			base,
			"/__mdxserve/trpc/addRoots",
			`attacker.example:${port}`,
			body,
		);
		expect(rebinding.status).toBe(403);
		expect(rebinding.text).toContain("FORBIDDEN");

		const genuine = await request(base, "/__mdxserve/trpc/addRoots", `127.0.0.1:${port}`, body);
		expect(genuine.status).toBe(200);
	});
});
