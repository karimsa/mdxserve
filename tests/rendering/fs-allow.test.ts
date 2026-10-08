import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { allowFsDir, createDevServer, disallowFsDir } from "../../src/rendering/vite.js";

let extraDir: string;
let filePath: string;
let vite: ViteDevServer;
let base: string;
let httpServer: http.Server;

beforeAll(async () => {
	const viteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-fsallow-viteroot-"));
	const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-fsallow-cache-"));
	// Not part of the dev server's roots, so it starts outside fs.allow.
	extraDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-fsallow-extra-")));
	filePath = path.join(extraDir, "secret.txt");
	await fs.writeFile(filePath, "top secret\n", "utf8");

	httpServer = http.createServer();
	vite = await createDevServer({
		roots: [],
		viteRoot,
		cacheDir,
		httpServer,
	});
	httpServer.on("request", (req, res) => {
		vite.middlewares(req, res, () => {
			res.statusCode = 404;
			res.end("Not found");
		});
	});
	await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
	const port = (httpServer.address() as AddressInfo).port;
	base = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(async () => {
	await vite.close();
	await new Promise<void>((resolve) => httpServer.close(() => resolve()));
	await fs.rm(extraDir, { recursive: true, force: true });
});

describe("allowFsDir / disallowFsDir", () => {
	it("denies a file outside fs.allow, then serves it once its directory is allowed", async () => {
		const url = `${base}/@fs${encodeURI(filePath)}`;

		const before = await fetch(url);
		expect(before.status).not.toBe(200);

		allowFsDir(vite, extraDir);
		const after = await fetch(url);
		expect(after.status).toBe(200);
		expect(await after.text()).toBe("top secret\n");

		disallowFsDir(vite, extraDir);
		const removed = await fetch(url);
		expect(removed.status).not.toBe(200);
	});
});
