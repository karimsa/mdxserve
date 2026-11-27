import path from "node:path";
import { expect, it } from "vitest";
import { array, assert, asyncProperty, record, stringMatching } from "fast-check";
import { createCallerFactory } from "../../src/api/trpc.js";
import { appRouter } from "../../src/api/router.js";
import { fixtureRegistry as registry } from "../fixtures/registry.js";
import { makeContext } from "../helpers/context.js";
import { testServerInfo } from "../helpers/server-info.js";

const createCaller = createCallerFactory(appRouter);

// Distinctive enough that a match in the answer can only come from the root itself.
const segment = stringMatching(/^[A-Za-z][A-Za-z0-9_-]{5,20}$/).map((text) => `Zq${text}`);

it("never answers with a mounted root's name or path", async () => {
	await assert(
		asyncProperty(
			array(record({ name: segment, parent: segment }), { minLength: 1, maxLength: 6 }),
			async (roots) => {
				const rootInfos = roots.map(({ name, parent }) => ({
					name,
					dir: path.join("/", parent, name),
				}));
				const caller = createCaller(
					makeContext("/nonexistent-root", registry, {
						rootInfos,
						serverInfo: testServerInfo({}, ["box.tail1.ts.net:4040"]),
					}),
				);
				const answer = JSON.stringify(await caller.getServerInfo());
				for (const root of rootInfos) {
					expect(answer).not.toContain(root.name);
					expect(answer).not.toContain(root.dir);
				}
			},
		),
		{ numRuns: 100 },
	);
});
