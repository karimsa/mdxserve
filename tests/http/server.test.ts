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

describe("hosted site shell defaults", () => {
	it.each([
		["1", "1"],
		["0", "0"],
		[undefined, "0"],
	])("advertises immutable-site mode only for MDXSERVE_IMMUTABLE_SITE=%s", (setting, expected) => {
		vi.stubEnv("MDXSERVE_IMMUTABLE_SITE", setting);
		try {
			const html = renderShell({ kind: "notfound", path: "/x" });
			expect(html).toContain(`data-immutable-site="${expected}"`);
		} finally {
			vi.unstubAllEnvs();
		}
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

describe("restricted permissions", () => {
	it.each(["entry.tsx%5C..%5C..%5C.hidden.tsx", "entry.tsx%5C..%2F..%5C.hidden.tsx"])(
		"rejects encoded separators in %s before routing internal files to Vite",
		async (rest) => {
			const middleware = vi.fn((_req: unknown, res: http.ServerResponse) => {
				res.statusCode = 200;
				res.end("vite");
			});
			const vite = { middlewares: middleware } as unknown as ViteDevServer;
			const { base } = await startWith({ permissions: "restricted", vite });
			const response = await fetch(`${base}/__mdxserve/${rest}`);
			expect(response.status).toBe(404);
			expect(middleware).not.toHaveBeenCalled();
		},
	);

	it("serves the reader but denies same-origin writes and local-only reads on a loopback connection", async () => {
		const { base } = await startWith({ permissions: "restricted", vite: htmlVite() });
		const client = createTRPCClient<AppRouter>({
			links: [httpLink({ url: `${base}/__mdxserve/trpc`, headers: { origin: base } })],
		});
		const docPath = path.join(fixtureDir, "good.md");
		const source = await client.getDocSource.query({ path: docPath });
		const tree = await client.getDocTree.query({});
		expect(tree.roots).toHaveLength(1);
		const page = await fetch(`${base}${encodeURI(docPath)}`, { headers: { accept: "text/html" } });
		expect(page.status).toBe(200);
		const html = await page.text();
		expect(html).toContain('data-permissions="restricted"');
		expect(html).toContain('data-same-machine="0"');

		await expect(
			client.saveDocSection.mutate({
				path: docPath,
				startLine: 3,
				endLine: 3,
				version: source.version,
				markdown: "Defaced",
			}),
		).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
		await expect(client.moveDocsToTrash.mutate({ paths: [docPath] })).rejects.toMatchObject({
			data: { code: "FORBIDDEN" },
		});
		await expect(client.addRoots.mutate({ dirs: [fixtureDir] })).rejects.toMatchObject({
			data: { code: "FORBIDDEN" },
		});
		await expect(client.exportDoc.mutate({ path: docPath })).rejects.toMatchObject({
			data: { code: "FORBIDDEN" },
		});
		await expect(client.getDiagramPreferences.query({})).rejects.toMatchObject({
			data: { code: "FORBIDDEN" },
		});
		expect(await fs.readFile(docPath, "utf8")).toBe(source.text);
	});

	it("blocks hidden files and links out of the root through both file routes", async () => {
		const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-hosting-outside-"));
		const visible = path.join(fixtureDir, "hosting-visible.txt");
		const hidden = path.join(fixtureDir, ".hosting-hidden.txt");
		const outside = path.join(outsideDir, "outside.txt");
		const linked = path.join(fixtureDir, "hosting-linked.txt");
		const hiddenLink = path.join(fixtureDir, "hosting-hidden-link.txt");
		try {
			await fs.writeFile(visible, "visible");
			await fs.writeFile(hidden, "hidden");
			await fs.writeFile(outside, "outside");
			await fs.symlink(outside, linked);
			await fs.symlink(hidden, hiddenLink);
			const vite = {
				middlewares: (_req: unknown, res: http.ServerResponse) => {
					res.statusCode = 200;
					res.end("vite");
				},
			} as unknown as ViteDevServer;
			const { base } = await startWith({ permissions: "restricted", vite });
			for (const filePath of [hidden, linked, hiddenLink]) {
				for (const prefix of ["", "/@fs"]) {
					const response = await fetch(`${base}${prefix}${encodeURI(filePath)}`);
					expect(response.status).toBe(404);
				}
			}
			for (const prefix of ["", "/@fs"]) {
				const response = await fetch(`${base}${prefix}${encodeURI(visible)}`);
				expect(response.status).toBe(200);
			}
		} finally {
			await Promise.all([
				fs.rm(visible, { force: true }),
				fs.rm(hidden, { force: true }),
				fs.rm(linked, { force: true }),
				fs.rm(hiddenLink, { force: true }),
			]);
			await fs.rm(outsideDir, { recursive: true, force: true });
		}
	});

	it("omits private symlink targets from source, listings, tree, and search", async () => {
		const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-hosting-doc-outside-"));
		const hidden = path.join(fixtureDir, ".hosting-private.mdx");
		const outside = path.join(outsideDir, "outside.mdx");
		const hiddenLink = path.join(fixtureDir, "hosting-private-link.mdx");
		const outsideLink = path.join(fixtureDir, "hosting-outside-link.mdx");
		const visibleLink = path.join(fixtureDir, "hosting-visible-link.mdx");
		try {
			await fs.writeFile(hidden, "# Hidden\n\nPrivate phrase\n");
			await fs.writeFile(outside, "# Outside\n\nOutside phrase\n");
			await fs.symlink(hidden, hiddenLink);
			await fs.symlink(outside, outsideLink);
			await fs.symlink(path.join(fixtureDir, "good.md"), visibleLink);
			const { base } = await startWith({ permissions: "restricted", vite: htmlVite() });
			const client = createTRPCClient<AppRouter>({
				links: [httpLink({ url: `${base}/__mdxserve/trpc` })],
			});
			const listing = await client.getFolderListing.query({ path: fixtureDir });
			const names = listing.entries.map((entry) => entry.name);
			expect(names).toContain(path.basename(visibleLink));
			expect(names).not.toContain(path.basename(hiddenLink));
			expect(names).not.toContain(path.basename(outsideLink));
			const tree = await client.getDocTree.query({});
			const paths = tree.roots[0].nodes.map((node) => node.path);
			expect(paths).toContain(visibleLink);
			expect(paths).not.toContain(hiddenLink);
			expect(paths).not.toContain(outsideLink);
			expect((await client.searchDocs.query({ query: "Private phrase" })).results).toEqual([]);
			expect((await client.searchDocs.query({ query: "Outside phrase" })).results).toEqual([]);
			await expect(client.getDocSource.query({ path: hiddenLink })).rejects.toMatchObject({
				data: { code: "NOT_FOUND" },
			});
			await expect(client.getDocSource.query({ path: outsideLink })).rejects.toMatchObject({
				data: { code: "NOT_FOUND" },
			});
			expect((await client.getDocSource.query({ path: visibleLink })).text).toContain("Hello.");
		} finally {
			await Promise.all([
				fs.rm(hidden, { force: true }),
				fs.rm(hiddenLink, { force: true }),
				fs.rm(outsideLink, { force: true }),
				fs.rm(visibleLink, { force: true }),
			]);
			await fs.rm(outsideDir, { recursive: true, force: true });
		}
	});

	it("keeps visible doc and directory aliases to hidden targets in full mode only", async () => {
		const hiddenDir = path.join(fixtureDir, ".hosting-drafts");
		const dirAlias = path.join(fixtureDir, "hosting-drafts");
		const aliases = ["md", "mdx"].map((extension) => ({
			target: path.join(hiddenDir, `guide.${extension}`),
			alias: path.join(fixtureDir, `hosting-guide.${extension}`),
		}));
		try {
			await fs.mkdir(hiddenDir);
			for (const { target, alias } of aliases) {
				await fs.writeFile(target, `# ${path.extname(target)} guide\n`);
				await fs.symlink(target, alias);
			}
			await fs.symlink(hiddenDir, dirAlias, "dir");

			for (const permissions of ["full", "restricted"] as const) {
				const { base } = await startWith({ permissions });
				const client = createTRPCClient<AppRouter>({
					links: [httpLink({ url: `${base}/__mdxserve/trpc` })],
				});
				for (const { alias } of aliases) {
					if (permissions === "full") {
						expect((await client.getDocSource.query({ path: alias })).text).toContain("guide");
					} else {
						await expect(client.getDocSource.query({ path: alias })).rejects.toMatchObject({
							data: { code: "NOT_FOUND" },
						});
					}
				}
				if (permissions === "full") {
					expect((await client.getFolderListing.query({ path: dirAlias })).entries).toHaveLength(2);
					expect((await client.getDocTree.query({ path: dirAlias })).roots).toHaveLength(1);
				} else {
					await expect(client.getFolderListing.query({ path: dirAlias })).rejects.toMatchObject({
						data: { code: "NOT_FOUND" },
					});
					await expect(client.getDocTree.query({ path: dirAlias })).rejects.toMatchObject({
						data: { code: "NOT_FOUND" },
					});
				}
			}
		} finally {
			await Promise.all(aliases.map(({ alias }) => fs.rm(alias, { force: true })));
			await fs.rm(dirAlias, { force: true });
			await fs.rm(hiddenDir, { recursive: true, force: true });
		}
	});
});
