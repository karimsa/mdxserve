import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import type { ApiContext } from "../../src/api/trpc.js";
import type { RenderOutcome } from "../../src/rendering/protocol.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext as buildContext } from "../helpers/context.js";

let fixtureDir: string;
let outsideDir: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-validation-controller-test-")),
	);
	outsideDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-validation-controller-outside-")),
	);

	await fs.writeFile(
		path.join(fixtureDir, "good.md"),
		"# Good doc\n\nSome plain GFM content about widgets and gadgets.\n",
		"utf8",
	);
	await fs.writeFile(path.join(outsideDir, "secret.md"), "# Secret\n", "utf8");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
	await fs.rm(outsideDir, { recursive: true, force: true });
});

function makeContext(overrides: Partial<ApiContext> = {}): ApiContext {
	return buildContext(fixtureDir, registry, overrides);
}

const createCaller = createCallerFactory(appRouter);

describe("validateDoc render gating", () => {
	it("isLoopback: false never runs the render stub (rendered: false)", async () => {
		const render = vi.fn(async (): Promise<RenderOutcome> => ({ ok: true }));
		const caller = createCaller(makeContext({ isLoopback: false, render }));
		const result = await caller.validateDoc({ path: path.join(fixtureDir, "good.md") });
		expect(result.rendered).toBe(false);
		expect(render).not.toHaveBeenCalled();
	});

	it("isLoopback: true runs the render stub (rendered: true)", async () => {
		const render = vi.fn(async (): Promise<RenderOutcome> => ({ ok: true }));
		const caller = createCaller(makeContext({ isLoopback: true, render }));
		const result = await caller.validateDoc({ path: path.join(fixtureDir, "good.md") });
		expect(result.rendered).toBe(true);
		expect(render).toHaveBeenCalledOnce();
	});

	it("throws NOT_FOUND for a path outside every root", async () => {
		const caller = createCaller(makeContext());
		await expect(
			caller.validateDoc({ path: path.join(outsideDir, "secret.md") }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
