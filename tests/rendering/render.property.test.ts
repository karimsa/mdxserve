import fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ViteDevServer } from "vite";
import { createDevServer } from "../../src/rendering/vite.js";
import { RenderService } from "../../src/rendering/render.js";
import { getPackageRoot } from "../../src/infra/pkg.js";

// dist/render-worker.js is a gitignored build artifact. Unlike
// tests/rendering/render.test.ts (which builds it itself with esbuild), this
// file only checks for it — building a second, independent Vite dev server +
// worker just to run one cheap concurrency property isn't worth duplicating
// that cost here. When it's missing (a clean checkout before `yarn build`)
// this whole suite is skipped.
const workerScriptPath = path.join(getPackageRoot(), "dist", "render-worker.js");
const workerBuilt = fsSync.existsSync(workerScriptPath);

describe.skipIf(!workerBuilt)("RenderService#render — concurrency property", () => {
	let fixtureDir: string;
	let vite: ViteDevServer;
	let renderer: RenderService;
	let docCounter = 0;

	async function writeDoc(content: string): Promise<string> {
		const abs = path.join(fixtureDir, `concurrent-${docCounter++}.md`);
		await fs.writeFile(abs, content, "utf8");
		return abs;
	}

	beforeAll(async () => {
		fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-render-prop-test-"));
		const viteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-render-prop-viteroot-"));
		const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-render-prop-cache-"));
		const httpServer = http.createServer();
		vite = await createDevServer({ roots: [fixtureDir], viteRoot, cacheDir, httpServer });
		renderer = new RenderService(vite);
		// First render on a fresh server spawns the worker and runs its warm-up;
		// give it a generous budget so the property's own renders only ever
		// measure the doc (see render.test.ts for the same pattern).
		const warm = await renderer.render(await writeDoc("# Warm\n"), { timeoutMs: 120_000 });
		expect(warm).toEqual({ ok: true });
	}, 180_000);

	afterAll(async () => {
		await vite.close();
		await fs.rm(fixtureDir, { recursive: true, force: true });
	});

	it("N concurrent renders on one RenderService return N outcomes matched to their own docs", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({ min: 2, max: 4 }), async (count) => {
				const docs = await Promise.all(
					Array.from({ length: count }, (_, index) =>
						writeDoc(`# Doc ${index}\n\nplain prose, no expressions.\n`),
					),
				);
				const outcomes = await Promise.all(docs.map((abs) => renderer.render(abs)));
				expect(outcomes).toHaveLength(count);
				for (const outcome of outcomes) expect(outcome).toEqual({ ok: true });
			}),
			{ numRuns: 3 },
		);
	}, 60_000);
});
