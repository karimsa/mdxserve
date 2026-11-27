import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext } from "../helpers/context.js";

const createCaller = createCallerFactory(appRouter);
const PROPERTY_TIMEOUT_MS = 30000;

async function rmTree(dirAbs: string): Promise<void> {
	await fs.rm(dirAbs, { recursive: true, force: true });
}

// --- validateDoc ----------------------------------------------------------

describe("validateDoc", () => {
	it(
		"returns the same result for loopback and remote callers",
		async () => {
			await fc.assert(
				fc.asyncProperty(fc.boolean(), async (isLoopback) => {
					const root = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-prop-validate-"));
					try {
						const docPath = path.join(root, "doc.md");
						await fs.writeFile(docPath, "# Doc\n\nplain content.\n", "utf8");
						const caller = createCaller(makeContext(root, registry, { isLoopback }));
						const result = await caller.validateDoc({ path: docPath });
						expect(result).toMatchObject({ ok: true, diagnostics: [] });
						expect(result).not.toHaveProperty("rendered");
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
