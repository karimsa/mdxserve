import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { createDevServer } from "../../src/rendering/vite.js";
import { RenderService } from "../../src/rendering/render.js";
import { getPackageRoot } from "../../src/infra/pkg.js";
import { build } from "esbuild";

let fixtureDir: string;
let vite: ViteDevServer;
let renderer: RenderService;

async function writeDoc(name: string, content: string): Promise<string> {
	const abs = path.join(fixtureDir, name);
	await fs.writeFile(abs, content, "utf8");
	return abs;
}

beforeAll(async () => {
	fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-render-test-"));
	const viteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-render-viteroot-"));
	const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-render-cache-"));
	// dist/render-worker.js is a gitignored build artifact and CI runs tests
	// before `yarn build`, so produce it here exactly the way the build script
	// does — otherwise RenderService#render short-circuits with its "run yarn
	// build" outcome on a clean checkout and none of these tests exercise SSR.
	await build({
		entryPoints: [path.join(getPackageRoot(), "src", "rendering", "render-worker.ts")],
		bundle: true,
		platform: "node",
		format: "esm",
		packages: "external",
		outfile: path.join(getPackageRoot(), "dist", "render-worker.js"),
	});
	const httpServer = http.createServer();
	vite = await createDevServer({
		roots: [fixtureDir],
		viteRoot,
		cacheDir,
		httpServer,
	});
	renderer = new RenderService(vite);
	// First render on a fresh server: spawns the worker and runs the warm-up
	// (SSR dep optimizer, react, every builtin). Give it a CI-sized budget
	// here so the per-test default timeout only ever measures a doc.
	const warm = await renderer.render(await writeDoc("warm.md", "# Warm\n"), {
		timeoutMs: 120_000,
	});
	expect(warm).toEqual({ ok: true });
}, 180_000);

afterAll(async () => {
	await vite.close();
	await fs.rm(fixtureDir, { recursive: true, force: true });
});

describe("RenderService#render", () => {
	it("reports a render-time ReferenceError with a matching line number", async () => {
		const abs = await writeDoc(
			"bare-identifier.md",
			["# Hello", "", "Some prose with {foo} in it."].join("\n"),
		);
		const outcome = await renderer.render(abs);
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error("unreachable");
		expect(outcome.message).toContain("foo is not defined");
		expect(outcome.line).toBe(3);
	});

	it("recovers a render queued behind a timed-out one", async () => {
		const hung = await writeDoc(
			"hang-queued.md",
			"export const x = (() => { while (true) {} })();\n",
		);
		const good = await writeDoc("good-queued.md", "# Fine\n\nplain prose\n");
		// Fire both before either settles: the good doc queues behind the hung
		// one, whose timeout terminates the worker they were both scheduled on.
		const [hungOutcome, goodOutcome] = await Promise.all([
			renderer.render(hung, { timeoutMs: 500 }),
			renderer.render(good, { timeoutMs: 5000 }),
		]);
		expect(hungOutcome.ok).toBe(false);
		if (hungOutcome.ok) throw new Error("unreachable");
		expect(hungOutcome.message).toContain("timed out");
		expect(goodOutcome).toEqual({ ok: true });
	});

	it("re-renders a doc from disk after it changes", async () => {
		const abs = await writeDoc("edited.md", "# Hello\n\nSome prose with {foo} in it.\n");
		const before = await renderer.render(abs);
		expect(before.ok).toBe(false);
		await writeDoc(
			"edited.md",
			"export const foo = 1\n\n# Hello\n\nSome prose with {foo} in it.\n",
		);
		const after = await renderer.render(abs);
		expect(after).toEqual({ ok: true });
		await writeDoc("edited.md", "# Hello\n\nSome prose with {bar} in it.\n");
		const again = await renderer.render(abs);
		expect(again.ok).toBe(false);
		if (again.ok) throw new Error("unreachable");
		expect(again.message).toContain("bar is not defined");
	});

	it("renders ok once the identifier is bound", async () => {
		const abs = await writeDoc(
			"bound-identifier.md",
			["export const foo = 1", "", "# Hello", "", "Some prose with {foo} in it."].join("\n"),
		);
		const outcome = await renderer.render(abs);
		expect(outcome).toEqual({ ok: true });
	});

	it("renders every builtin, a fence, a GFM table, and a task list", async () => {
		const abs = await writeDoc(
			"kitchen-sink.mdx",
			[
				"# Kitchen sink",
				"",
				'<Callout tone="warn" title="Careful">Body text.</Callout>',
				"",
				'<Badge tone="ok" dot>Shipped</Badge>',
				"",
				"<Tabs>",
				'  <Tab label="One">First panel.</Tab>',
				'  <Tab label="Two">Second panel.</Tab>',
				"</Tabs>",
				"",
				"Press <Kbd>⌘</Kbd><Kbd>K</Kbd> to open the palette.",
				"",
				"```js",
				"const x = 1;",
				"```",
				"",
				"| a | b |",
				"| --- | --- |",
				"| 1 | 2 |",
				"",
				"- [x] done",
				"- [ ] not done",
				"",
			].join("\n"),
		);
		const outcome = await renderer.render(abs);
		expect(outcome).toEqual({ ok: true });
	});

	// A genuinely async hang (a top-level `await` on a promise that never
	// settles): the render worker yields to its own event loop, so the
	// timeout races it and wins well before `timeoutMs` would matter for
	// termination itself.
	it("times out on a document that hangs asynchronously", async () => {
		const abs = await writeDoc(
			"async-hang.mdx",
			["export const x = await new Promise(() => {});", "", "# Never resolves"].join("\n"),
		);
		const outcome = await renderer.render(abs, { timeoutMs: 300 });
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error("unreachable");
		expect(outcome.message).toContain("timed out");
	}, 10000);

	// Module execution happens in a disposable worker thread (src/rendering/render.ts),
	// specifically so this case is survivable: a genuine synchronous infinite
	// loop at a document's top level cannot be preempted from inside the
	// thread it runs on (JS is single threaded), but the main thread can
	// still `Worker#terminate()` it from outside — which forcibly stops the
	// worker's isolate even mid-loop. Before this change, the equivalent
	// fixture with a 300ms `timeoutMs` hung the whole vitest process
	// indefinitely (confirmed by hand, killed manually after 45s+) because
	// rendering ran in-process behind a `Promise.race` that never got a turn
	// to run.
	it("times out on a document with a synchronous infinite loop, without hanging the process", async () => {
		const abs = await writeDoc(
			"sync-loop.mdx",
			["export const x = (() => { while (true) {} })();", "", "# Never returns"].join("\n"),
		);
		const outcome = await renderer.render(abs, { timeoutMs: 300 });
		expect(outcome.ok).toBe(false);
		if (outcome.ok) throw new Error("unreachable");
		expect(outcome.message).toContain("timed out");
	}, 10000);

	// The worker that hung above is terminated and dropped; the next render
	// on the same `vite` server must transparently respawn a fresh one rather
	// than staying wedged.
	it("respawns a working worker after a prior render timed out", async () => {
		const abs = await writeDoc(
			"after-timeout.md",
			["# Still works", "", "Some prose with no expressions."].join("\n"),
		);
		const outcome = await renderer.render(abs);
		expect(outcome).toEqual({ ok: true });
	});

	// Renders on the same `vite` server (and therefore the same worker
	// handle) are serialized through a promise queue precisely so calls like
	// these two, issued concurrently, can't interleave the worker's
	// request/response protocol; both must still resolve correctly.
	it("handles two concurrent renders on different documents", async () => {
		const first = await writeDoc("concurrent-one.md", ["# One", "", "Some prose."].join("\n"));
		const second = await writeDoc(
			"concurrent-two.md",
			["# Two", "", "Some other prose."].join("\n"),
		);
		const [firstOutcome, secondOutcome] = await Promise.all([
			renderer.render(first),
			renderer.render(second),
		]);
		expect(firstOutcome).toEqual({ ok: true });
		expect(secondOutcome).toEqual({ ok: true });
	});
});
