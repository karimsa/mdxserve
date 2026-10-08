import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import type { RenderOutcome } from "../../src/rendering/protocol.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext } from "../helpers/context.js";

const createCaller = createCallerFactory(appRouter);
const PROPERTY_TIMEOUT_MS = 30000;

async function rmTree(dirAbs: string): Promise<void> {
	await fs.rm(dirAbs, { recursive: true, force: true });
}

// --- validateDoc render gating --------------------------------------------

const renderOutcomeArb: fc.Arbitrary<RenderOutcome> = fc.oneof(
	fc.constant<RenderOutcome>({ ok: true }),
	fc.string({ minLength: 1, maxLength: 20 }).map((message) => ({ ok: false as const, message })),
);

describe("validateDoc render gating", () => {
	it(
		"rendered is exactly ctx.isLoopback, and the render stub only runs when isLoopback",
		async () => {
			await fc.assert(
				fc.asyncProperty(fc.boolean(), renderOutcomeArb, async (isLoopback, outcome) => {
					const root = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-prop-render-"));
					try {
						const docPath = path.join(root, "doc.md");
						await fs.writeFile(docPath, "# Doc\n\nplain content.\n", "utf8");
						const render = vi.fn(async (): Promise<RenderOutcome> => outcome);
						const caller = createCaller(makeContext(root, registry, { isLoopback, render }));

						const result = await caller.validateDoc({ path: docPath });
						expect(result.rendered).toBe(isLoopback);
						expect(render).toHaveBeenCalledTimes(isLoopback ? 1 : 0);
					} finally {
						await rmTree(root);
					}
				}),
				{ numRuns: 15 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});
