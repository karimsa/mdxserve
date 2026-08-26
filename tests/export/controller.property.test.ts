import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { TRPCError } from "@trpc/server";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import type { ApiContext } from "../../src/api/trpc.js";
import { MERMAID_MODES, EXPORT_FORMATS } from "../../src/export/service.js";
import type { BundleInput, BundlePort } from "../../src/rendering/protocol.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext as buildContext } from "../helpers/context.js";

const PROPERTY_TIMEOUT_MS = 30000;
const createCaller = createCallerFactory(appRouter);
const KNOWN_CODES = new Set(["FORBIDDEN", "NOT_FOUND", "BAD_REQUEST", "INTERNAL_SERVER_ERROR"]);

let fixtureDir: string;

beforeAll(async () => {
	fixtureDir = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-export-controller-prop-")),
	);
	await fs.writeFile(
		path.join(fixtureDir, "fenced.md"),
		"# Fenced\n\n```mermaid\ngraph TD\nA-->B\n```\n",
		"utf8",
	);
	await fs.writeFile(path.join(fixtureDir, "plain.md"), "# Plain\n\nno diagrams\n", "utf8");
});

afterAll(async () => {
	await fs.rm(fixtureDir, { recursive: true, force: true });
});

function fakeBundle(): { port: BundlePort; calls: BundleInput[] } {
	const calls: BundleInput[] = [];
	return {
		calls,
		port: async (input) => {
			calls.push(input);
			return { js: "", css: "", warnings: [] };
		},
	};
}

function makeContext(overrides: Partial<ApiContext> = {}): ApiContext {
	return buildContext(fixtureDir, registry, overrides);
}

describe("exportDoc — properties", () => {
	it(
		"a non-loopback caller never resolves, for arbitrary path strings",
		async () => {
			await fc.assert(
				fc.asyncProperty(fc.string({ minLength: 1, maxLength: 200 }), async (pathValue) => {
					const { port } = fakeBundle();
					await expect(
						createCaller(makeContext({ isLoopback: false, bundle: port })).exportDoc({
							path: pathValue,
						}),
					).rejects.toMatchObject({ code: "FORBIDDEN" });
				}),
				{ numRuns: 20 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"every thrown error is a TRPCError with a code from the declared set",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.string({ minLength: 1, maxLength: 200 }),
					fc.boolean(),
					async (pathValue, isLoopback) => {
						const { port } = fakeBundle();
						try {
							await createCaller(makeContext({ isLoopback, bundle: port })).exportDoc({
								path: pathValue,
							});
						} catch (error) {
							expect(error).toBeInstanceOf(TRPCError);
							expect(KNOWN_CODES.has((error as TRPCError).code)).toBe(true);
						}
					},
				),
				{ numRuns: 25 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"against fenced.md, the call resolves and result.mermaid equals the requested mode",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.constantFrom(...EXPORT_FORMATS),
					fc.constantFrom(...MERMAID_MODES),
					async (format, mermaid) => {
						const { port } = fakeBundle();
						const result = await createCaller(
							makeContext({ isLoopback: true, bundle: port }),
						).exportDoc({ path: path.join(fixtureDir, "fenced.md"), format, mermaid });
						expect(result.mermaid).toBe(mermaid);
					},
				),
				{ numRuns: 15 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"against plain.md, result.mermaid is always none regardless of the requested mode",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.constantFrom(...EXPORT_FORMATS),
					fc.constantFrom(...MERMAID_MODES),
					async (format, mermaid) => {
						const { port } = fakeBundle();
						const result = await createCaller(
							makeContext({ isLoopback: true, bundle: port }),
						).exportDoc({ path: path.join(fixtureDir, "plain.md"), format, mermaid });
						expect(result.mermaid).toBe("none");
					},
				),
				{ numRuns: 15 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});
