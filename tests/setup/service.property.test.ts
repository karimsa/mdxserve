import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import fc from "fast-check";
import { MCP_CLEANUPS, planSetup } from "../../src/setup/plan.js";
import { SetupService } from "../../src/setup/service.js";
import { fakeRunner } from "./fake-runner.js";

const PROPERTY_TIMEOUT_MS = 30000;

const namesArb = fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/), { maxLength: 3 });
const availableArb = fc.subarray(["claude", "codex"]).map((names) => new Set(names));
const codeArb = fc.constantFrom(0, 1, 2, 127);

const created: string[] = [];
afterEach(async () => {
	for (const dir of created.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function makePkg(names: string[]): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-setup-prop-"));
	created.push(root);
	for (const name of names) {
		await fs.mkdir(path.join(root, "skills", name), { recursive: true });
		await fs.writeFile(path.join(root, "skills", name, "SKILL.md"), "x");
	}
	return root;
}

describe("SetupService properties", () => {
	it(
		"matches the plan oracle, ordering and skills invariants",
		async () => {
			await fc.assert(
				fc.asyncProperty(namesArb, availableArb, async (names, available) => {
					const root = await makePkg(names);
					const skillsRoot = path.join(root, "skills");
					const runner = fakeRunner({ available, exitCodes: () => 0 });
					const result = await new SetupService({ pkgRoot: root, runner }).run();

					const hasSkills = names.length > 0;
					const planned = planSetup({ skillsRoot, hasSkills, available }).map((step) => ({
						command: step.command,
						args: step.args,
						inherit: step.inherit,
					}));
					expect(runner.log).toEqual(planned);

					if (hasSkills) {
						const first = runner.log[0];
						expect(first.command).toBe("npx");
						expect(first.args.slice(0, 4)).toEqual(["-y", "skills", "add", skillsRoot]);
						expect(first.args.filter((arg) => arg === "-y")).toHaveLength(2);
						for (const flag of ["-g", "-s", "*"]) expect(first.args).toContain(flag);
					} else {
						expect(runner.log.some((call) => call.command === "npx")).toBe(false);
					}

					expect(result.kind).toBe("ok");
					if (result.kind !== "ok") return;
					expect(result.skills).toBe(hasSkills ? "installed" : "none");
					expect(result.cleanups.map((cleanup) => cleanup.client)).toEqual(
						MCP_CLEANUPS.map((cleanup) => cleanup.client),
					);
					for (const cleanup of result.cleanups) {
						if (!available.has(cleanup.client)) {
							expect(cleanup.status).toBe("not-installed");
							expect(runner.log.some((call) => call.command === cleanup.client)).toBe(false);
						}
					}
				}),
				{ numRuns: 30 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"isolates cleanup failures; only the skills exit code decides ok vs error",
		async () => {
			await fc.assert(
				fc.asyncProperty(
					namesArb,
					availableArb,
					codeArb,
					fc.dictionary(fc.constantFrom("claude", "codex"), codeArb),
					async (names, available, skillsCode, cleanupCodes) => {
						const root = await makePkg(names);
						const runner = fakeRunner({
							available,
							exitCodes: (command) =>
								command === "npx" ? skillsCode : (cleanupCodes[command] ?? 0),
						});
						const result = await new SetupService({ pkgRoot: root, runner }).run();
						if (names.length > 0 && skillsCode !== 0) {
							expect(result.kind).toBe("error");
							return;
						}
						expect(result.kind).toBe("ok");
						if (result.kind !== "ok") return;
						for (const cleanup of result.cleanups) {
							if (!available.has(cleanup.client)) continue;
							expect(cleanup.status).toBe(
								(cleanupCodes[cleanup.client] ?? 0) === 0 ? "removed" : "absent",
							);
						}
					},
				),
				{ numRuns: 40 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);

	it(
		"is idempotent: two runs yield identical logs",
		async () => {
			await fc.assert(
				fc.asyncProperty(namesArb, availableArb, async (names, available) => {
					const root = await makePkg(names);
					const first = fakeRunner({ available, exitCodes: () => 0 });
					const second = fakeRunner({ available, exitCodes: () => 0 });
					await new SetupService({ pkgRoot: root, runner: first }).run();
					await new SetupService({ pkgRoot: root, runner: second }).run();
					expect(second.log).toEqual(first.log);
				}),
				{ numRuns: 30 },
			);
		},
		PROPERTY_TIMEOUT_MS,
	);
});
