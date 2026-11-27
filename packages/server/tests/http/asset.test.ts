import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getAssetUrl, GET_ASSET_PATH } from "../../src/assets/url.js";
import type { PermissionMode } from "../../src/servers/bind-host.js";
import { makeRequestContext, startTestServer } from "../helpers/http.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";

let base: string;
let root: string;
let outside: string;

beforeAll(async () => {
	base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-get-asset-")));
	root = path.join(base, "root");
	outside = path.join(base, "outside");
	await fs.mkdir(path.join(root, "img"), { recursive: true });
	await fs.mkdir(path.join(root, ".drafts"), { recursive: true });
	await fs.mkdir(outside, { recursive: true });
	await fs.writeFile(path.join(root, "img", "my shot.png"), "png-bytes");
	await fs.writeFile(path.join(root, "img", "diagram.svg"), "<svg/>");
	await fs.writeFile(path.join(root, ".drafts", "draft.png"), "draft");
	await fs.writeFile(path.join(root, "guide.md"), "# Guide\n");
	await fs.writeFile(path.join(outside, "secret.png"), "secret");
	await fs.symlink(path.join(outside, "secret.png"), path.join(root, "img", "out.png"));
});

afterAll(async () => {
	await fs.rm(base, { recursive: true, force: true });
});

let closers: (() => void)[] = [];
afterEach(() => {
	for (const close of closers) close();
	closers = [];
});

async function start(permissions: PermissionMode = "full"): Promise<string> {
	const { server, base: url } = await startTestServer(
		makeRequestContext(root, registry, { permissions }),
	);
	closers.push(() => server.close());
	return url;
}

/** A raw request, so `Host` and `Origin` can be set the way another page would send them. */
function rawGet(
	url: string,
	headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
	const target = new URL(url);
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				hostname: target.hostname,
				port: target.port,
				path: target.pathname + target.search,
				headers,
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => (body += chunk));
				res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
			},
		);
		req.on("error", reject);
		req.end();
	});
}

describe("GET /__mdxserve/getAsset", () => {
	it("serves a file in a root with its type, revalidation and isolation headers", async () => {
		const url = await start();
		const response = await fetch(`${url}${getAssetUrl(path.join(root, "img", "my shot.png"))}`);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("png-bytes");
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(response.headers.get("cache-control")).toBe("no-cache");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
		expect(response.headers.get("content-security-policy")).toBeNull();

		const etag = response.headers.get("etag") ?? "";
		const revalidated = await fetch(`${url}${getAssetUrl(path.join(root, "img", "my shot.png"))}`, {
			headers: { "If-None-Match": etag },
		});
		expect(revalidated.status).toBe(304);
	});

	it("answers HEAD without a body and refuses other methods", async () => {
		const url = await start();
		const target = `${url}${getAssetUrl(path.join(root, "img", "my shot.png"))}`;
		const head = await fetch(target, { method: "HEAD" });
		expect(head.status).toBe(200);
		expect(head.headers.get("content-length")).toBe("9");
		const post = await fetch(target, { method: "POST" });
		expect(post.status).toBe(405);
	});

	it("sandboxes a file that could run script when opened as a page", async () => {
		const url = await start();
		const response = await fetch(`${url}${getAssetUrl(path.join(root, "img", "diagram.svg"))}`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-security-policy")).toBe("sandbox");
	});

	it.each([
		["no path", ""],
		["an empty path", "?path="],
		["a relative path", "?path=img%2Fmy%20shot.png"],
		["an oversized path", `?path=${"%2Fa".repeat(3000)}`],
	])("400s %s", async (_label, query) => {
		const url = await start();
		const response = await fetch(`${url}${GET_ASSET_PATH}${query}`);
		expect(response.status).toBe(400);
	});

	it.each<[string, () => string]>([
		["a document", () => path.join(root, "guide.md")],
		["a file outside every root", () => path.join(outside, "secret.png")],
		["a .. climb out of the root", () => `${root}/img/../../outside/secret.png`],
		["a symlink out of the root", () => path.join(root, "img", "out.png")],
		["a directory", () => path.join(root, "img")],
	])("404s %s in either mode", async (_label, target) => {
		for (const permissions of ["full", "restricted"] as const) {
			const url = await start(permissions);
			const response = await fetch(`${url}${getAssetUrl(target())}`);
			expect(response.status).toBe(404);
			expect(await response.text()).not.toContain("secret");
		}
	});

	it("serves a hidden folder's file to a full server only", async () => {
		const draft = getAssetUrl(path.join(root, ".drafts", "draft.png"));
		expect((await fetch(`${await start("full")}${draft}`)).status).toBe(200);
		expect((await fetch(`${await start("restricted")}${draft}`)).status).toBe(404);
	});

	it("refuses a request whose Origin is another site, but not a same-origin one", async () => {
		const url = await start();
		const target = `${url}${getAssetUrl(path.join(root, "img", "my shot.png"))}`;
		const host = new URL(url).host;
		expect((await rawGet(target, { host, origin: "http://evil.example" })).status).toBe(403);
		expect((await rawGet(target, { host, origin: `http://${host}` })).status).toBe(200);
		expect((await rawGet(target, { host })).status).toBe(200);
	});
});

describe("a root file at its own path", () => {
	it("is served with the getAsset rules", async () => {
		const url = await start();
		const response = await fetch(`${url}${encodeURI(path.join(root, "img", "my shot.png"))}`);
		expect(response.status).toBe(200);
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		const out = await fetch(`${url}${encodeURI(path.join(root, "img", "out.png"))}`);
		expect(out.status).toBe(404);
	});
});
