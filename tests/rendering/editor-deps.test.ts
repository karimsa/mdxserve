import { createMetadataPort } from "../helpers/metadata.js";
import fs from "node:fs/promises";
import http from "node:http";
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
let installedPackage: string;

beforeAll(async () => {
	temporaryDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-editor-deps-")),
	);
	const packageRoot = getPackageRoot();
	installedPackage = path.join(temporaryDir, "node_modules", "@karimsa", "mdxserve");
	const installedEditorDir = path.join(installedPackage, "client", "editor");
	const installedDiagramsDir = path.join(installedPackage, "client", "diagrams");
	await fs.mkdir(installedEditorDir, { recursive: true });
	await fs.mkdir(installedDiagramsDir, { recursive: true });
	await fs.symlink(
		path.join(packageRoot, "node_modules"),
		path.join(installedPackage, "node_modules"),
	);
	for (const filename of ["mdx-block.tsx", "component-fields.ts", "slash.ts", "blocks.ts"]) {
		await fs.copyFile(
			path.join(packageRoot, "client", "editor", filename),
			path.join(installedEditorDir, filename),
		);
	}
	for (const filename of ["edit-block.ts", "source.ts"]) {
		await fs.copyFile(
			path.join(packageRoot, "client", "diagrams", filename),
			path.join(installedDiagramsDir, filename),
		);
	}
	server = http.createServer();
	vite = await createDevServer({
		metadata: createMetadataPort(),
		roots: [temporaryDir],
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
});

it("serves installed editor dependencies as optimized browser modules", async () => {
	const editorModules = [
		{
			file: "editor/mdx-block.tsx",
			dependencies: [
				"@tiptap/core",
				"@tiptap/react",
				"mdast-util-from-markdown",
				"mdast-util-mdx",
				"micromark-extension-mdxjs",
			],
		},
		{
			file: "editor/slash.ts",
			dependencies: ["@tiptap/core", "@tiptap/suggestion", "@tiptap/pm/state"],
		},
		{
			file: "diagrams/edit-block.ts",
			dependencies: ["@tiptap/core", "@tiptap/pm/state", "@tiptap/pm/view", "@tiptap/pm/history"],
		},
	];
	for (const editorModule of editorModules) {
		const installedFile = path.join(installedPackage, "client", editorModule.file);
		const response = await fetch(`${baseUrl}/@fs${encodeURI(installedFile)}`);
		expect(response.status, editorModule.file).toBe(200);
		const source = await response.text();
		const importUrls = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
		for (const dependency of editorModule.dependencies) {
			const optimizedName = dependency.replaceAll("/", "_");
			const optimizedUrl = importUrls.find((url) => url.includes(`/deps/${optimizedName}.js?`));
			expect(
				optimizedUrl,
				`${editorModule.file} should import optimized ${dependency}`,
			).toBeDefined();
			const dependencyResponse = await fetch(new URL(optimizedUrl!, baseUrl));
			expect(dependencyResponse.status, dependency).toBe(200);
		}
	}
});
