import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MCP_CLEANUPS, planSetup } from "../../src/setup/plan.js";

const availableArb = fc.subarray(["claude", "codex", "other"]).map((names) => new Set(names));

describe("planSetup properties", () => {
	it("lists skills first (iff present), then available cleanups in order", () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1 }),
				fc.boolean(),
				availableArb,
				(skillsRoot, hasSkills, available) => {
					const steps = planSetup({ skillsRoot, hasSkills, available });
					const expected = MCP_CLEANUPS.filter((cleanup) => available.has(cleanup.client)).map(
						(cleanup) => cleanup.client,
					);
					const commands = steps.map((step) => step.command);
					expect(commands).toEqual(hasSkills ? ["npx", ...expected] : expected);
					for (const step of steps) {
						expect(step.inherit).toBe(step.command === "npx");
						expect(step.ignoreFailure).toBe(step.command !== "npx");
					}
				},
			),
			{ numRuns: 50 },
		);
	});
});
