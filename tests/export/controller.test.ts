import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import type { ApiContext } from "../../src/api/trpc.js";
import type { BundleInput, BundlePort } from "../../src/rendering/protocol.js";
import { exportDocResultSchema, type ExportDocInput } from "../../src/export/controller.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext as buildContext } from "../helpers/context.js";

let fixtureDir: string;
let outsideDir: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-export-controller-test-")),
	);
	outsideDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-export-controller-outside-")),
	);

	await fs.writeFile(path.join(fixtureDir, "plain.md"), "# Plain\n\nNo diagrams.\n", "utf8");
	await fs.writeFile(path.join(fixtureDir, "notes.txt"), "not a doc\n", "utf8");
	await fs.writeFile(path.join(outsideDir, "secret.md"), "# Secret\n", "utf8");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
	await fs.rm(outsideDir, { recursive: true, force: true });
});

function fakeBundle(): { port: BundlePort; calls: BundleInput[] } {
	const calls: BundleInput[] = [];
	return {
		calls,
		port: async (input) => {
			calls.push(input);
			return { js: "console.log(1)", css: "body{}", warnings: [] };
		},
	};
}

function rejectingBundle(message: string): { port: BundlePort } {
	return {
		port: async () => {
			throw new Error(message);
		},
	};
}

function makeContext(overrides: Partial<ApiContext> = {}): ApiContext {
	return buildContext(fixtureDir, registry, { isLoopback: true, ...overrides });
}

const createCaller = createCallerFactory(appRouter);

describe("exportDoc", () => {
	it("returns a shape matching exportDocResultSchema, applying defaults when format/mermaid are omitted", async () => {
		const { port } = fakeBundle();
		const result = await createCaller(makeContext({ bundle: port })).exportDoc({
			path: path.join(fixtureDir, "plain.md"),
		});
		expect(() => exportDocResultSchema.parse(result)).not.toThrow();
		expect(result.fileName).toBe("plain.html");
		expect(result.mermaid).toBe("none");
	});

	it("rejects a non-loopback caller with FORBIDDEN", async () => {
		const { port } = fakeBundle();
		await expect(
			createCaller(makeContext({ isLoopback: false, bundle: port })).exportDoc({
				path: path.join(fixtureDir, "plain.md"),
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("rejects a cross-origin mutation with FORBIDDEN", async () => {
		const { port } = fakeBundle();
		await expect(
			createCaller(
				makeContext({ bundle: port, origin: "http://evil.test", host: "127.0.0.1:1" }),
			).exportDoc({ path: path.join(fixtureDir, "plain.md") }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("rejects every path with NOT_FOUND when no roots are mounted, without calling the bundle port", async () => {
		const { port, calls } = fakeBundle();
		await expect(
			createCaller(makeContext({ bundle: port, rootInfos: [] })).exportDoc({
				path: path.join(fixtureDir, "plain.md"),
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(calls).toHaveLength(0);
	});

	it("rejects a path outside every mounted root with NOT_FOUND", async () => {
		const { port } = fakeBundle();
		await expect(
			createCaller(makeContext({ bundle: port })).exportDoc({
				path: path.join(outsideDir, "secret.md"),
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects a non-.md/.mdx file with BAD_REQUEST", async () => {
		const { port } = fakeBundle();
		await expect(
			createCaller(makeContext({ bundle: port })).exportDoc({
				path: path.join(fixtureDir, "notes.txt"),
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("rejects an invalid mermaid mode with BAD_REQUEST (zod) and never calls the bundle port", async () => {
		const { port, calls } = fakeBundle();
		const badInput = {
			path: path.join(fixtureDir, "plain.md"),
			mermaid: "sometimes",
		} as unknown as ExportDocInput;
		await expect(
			createCaller(makeContext({ bundle: port })).exportDoc(badInput),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(calls).toHaveLength(0);
	});

	it("maps a rejecting bundle port to INTERNAL_SERVER_ERROR", async () => {
		const { port } = rejectingBundle("boom");
		await expect(
			createCaller(makeContext({ bundle: port })).exportDoc({
				path: path.join(fixtureDir, "plain.md"),
			}),
		).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
	});
});
