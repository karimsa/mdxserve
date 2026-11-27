import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadShellTemplate, renderShell } from "../../src/http/shell.js";
import { makeRequestContext, shellTemplate, startTestServer } from "../helpers/http.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

let clientDir: string;
let docsDir: string;

const TEMPLATE = `<!doctype html><html><head><!--mdxserve:head--><script type="module" src="/__mdxserve/assets/index-abc123.js"></script></head><body><div id="root"></div><!--mdxserve:body--></body></html>`;

beforeAll(async () => {
	clientDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-client-")));
	docsDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-client-docs-")));
	await fs.mkdir(path.join(clientDir, "assets"));
	await fs.writeFile(path.join(clientDir, "index.html"), TEMPLATE);
	await fs.writeFile(path.join(clientDir, "favicon.svg"), "<svg/>");
	await fs.writeFile(path.join(clientDir, "assets", "index-abc123.js"), "console.log(1)");
	await fs.writeFile(path.join(clientDir, "assets", "index-abc123.css"), "body{}");
	await fs.writeFile(path.join(clientDir, "secret.txt"), "not an asset");
	await fs.writeFile(path.join(docsDir, "guide.md"), "---\ntitle: The guide\n---\n# Guide\n");
});

afterAll(async () => {
	await fs.rm(clientDir, { recursive: true, force: true });
	await fs.rm(docsDir, { recursive: true, force: true });
});

let closers: (() => void)[] = [];
afterEach(() => {
	for (const close of closers) close();
	closers = [];
});

async function start(): Promise<string> {
	const context = makeRequestContext(docsDir, registry, {
		client: { dir: clientDir, template: loadShellTemplate(clientDir) },
	});
	const { server, base } = await startTestServer(context);
	closers.push(() => server.close());
	return base;
}

describe("built client files", () => {
	it("serves assets with a one-year immutable cache header and their type", async () => {
		const base = await start();
		const script = await fetch(`${base}/__mdxserve/assets/index-abc123.js`);
		expect(script.status).toBe(200);
		expect(script.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
		expect(await script.text()).toBe("console.log(1)");
		const style = await fetch(`${base}/__mdxserve/assets/index-abc123.css`);
		expect(style.headers.get("content-type")).toBe("text/css; charset=utf-8");
	});

	it.each([
		"/__mdxserve/assets/missing.js",
		"/__mdxserve/assets/..%2Fsecret.txt",
		"/__mdxserve/assets/%2E%2E/secret.txt",
		"/__mdxserve/assets/.hidden.js",
		"/__mdxserve/secret.txt",
		"/__mdxserve/index.html",
		"/__mdxserve/entry.tsx",
		"/__mdxserve/app.css",
	])("404s %s", async (pathname) => {
		const base = await start();
		const response = await fetch(`${base}${pathname}`);
		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain("not an asset");
	});

	it("serves the favicon from the built client", async () => {
		const base = await start();
		for (const pathname of ["/__mdxserve/favicon.svg", "/favicon.ico"]) {
			const response = await fetch(`${base}${pathname}`);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("image/svg+xml");
		}
	});
});

describe("the shell", () => {
	it("fills the built index.html with the head metadata and route JSON", async () => {
		const base = await start();
		const response = await fetch(`${base}${encodeURI(path.join(docsDir, "guide.md"))}`, {
			headers: { Accept: "text/html" },
		});
		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('<script type="module" src="/__mdxserve/assets/index-abc123.js">');
		expect(html).toContain("<!--mdxserve:head--><title>The guide</title><!--/mdxserve:head-->");
		expect(html).toMatch(/<!--mdxserve:body--><script id="__mdxserve_route"[^>]*>\{"kind":"doc"/);
		expect(html).toContain("<!--/mdxserve:body-->");
	});

	it("keeps a file name with $ patterns and comment markers inside its blocks", () => {
		const html = renderShell(shellTemplate(), {
			kind: "notfound",
			path: "/docs/$&$1<!--/mdxserve:body--></script>.md",
		});
		const body = /<!--mdxserve:body-->([\s\S]*?)<!--\/mdxserve:body-->/.exec(html)?.[1] ?? "";
		expect(body).toContain("$&$1");
		expect(body).toContain("<\\!--/mdxserve:body--><\\/script>");
		expect(body.match(/<\/script>/g)).toHaveLength(1);
	});

	it("refuses to start from a missing or markerless index.html", async () => {
		const empty = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-client-empty-"));
		try {
			expect(() => loadShellTemplate(empty)).toThrow(/dist\/client\/index.html is missing/);
			await fs.writeFile(path.join(empty, "index.html"), "<html><!--mdxserve:head--></html>");
			expect(() => loadShellTemplate(empty)).toThrow(/<!--mdxserve:body-->/);
		} finally {
			await fs.rm(empty, { recursive: true, force: true });
		}
	});
});
