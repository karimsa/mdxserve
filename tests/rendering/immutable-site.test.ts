import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { getPackageRoot } from "../../src/infra/pkg.js";
import { createDevServer } from "../../src/rendering/vite.js";

let vite: ViteDevServer;
let server: http.Server;
let temporaryDir: string;
let baseUrl: string;
let previousImmutableSite: string | undefined;

beforeAll(async () => {
	previousImmutableSite = process.env.MDXSERVE_IMMUTABLE_SITE;
	process.env.MDXSERVE_IMMUTABLE_SITE = "1";
	temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-immutable-site-"));
	server = http.createServer();
	vite = await createDevServer({
		roots: [path.join(getPackageRoot(), "site")],
		viteRoot: temporaryDir,
		cacheDir: path.join(temporaryDir, "cache"),
		httpServer: server,
	});
	server.on("request", (request, response) => {
		vite.middlewares(request, response, () => {
			response.statusCode = 404;
			response.end();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
	await vite?.close();
	await new Promise<void>((resolve) => server?.close(() => resolve()));
	await fs.rm(temporaryDir, { recursive: true, force: true });
	if (previousImmutableSite === undefined) delete process.env.MDXSERVE_IMMUTABLE_SITE;
	else process.env.MDXSERVE_IMMUTABLE_SITE = previousImmutableSite;
});

it("serves the app and every site document with one optimized dependency version", async () => {
	const packageRoot = getPackageRoot();
	const siteDir = path.join(packageRoot, "site");
	const examples = (await fs.readdir(path.join(siteDir, "examples")))
		.filter((name) => name.endsWith(".mdx"))
		.map((name) => path.join(siteDir, "examples", name));
	const paths = [
		path.join(packageRoot, "client", "entry.tsx"),
		path.join(packageRoot, "client", "App.tsx"),
		path.join(packageRoot, "client", "ui", "Icon.tsx"),
		path.join(siteDir, "README.mdx"),
		...examples,
	];
	const versions = new Set<string>();
	for (const filePath of paths) {
		const response = await fetch(`${baseUrl}/@fs${encodeURI(filePath)}`);
		expect(response.status, filePath).toBe(200);
		const body = await response.text();
		for (const match of body.matchAll(/\/deps\/[^"']+\?v=([a-f0-9]+)/g)) versions.add(match[1]);
	}
	expect(versions.size).toBe(1);
});
