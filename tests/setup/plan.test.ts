import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	discoverSkills,
	MCP_CLEANUPS,
	planSetup,
	skillsInstallCommand,
} from "../../src/setup/plan.js";

let tmp: string | undefined;
afterEach(async () => {
	if (tmp) await fs.rm(tmp, { recursive: true, force: true });
	tmp = undefined;
});

describe("discoverSkills", () => {
	it("ignores folders without SKILL.md, sorts, and tolerates a missing dir", async () => {
		tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-plan-"));
		for (const name of ["zeta", "alpha"]) {
			await fs.mkdir(path.join(tmp, name));
			await fs.writeFile(path.join(tmp, name, "SKILL.md"), "x");
		}
		await fs.mkdir(path.join(tmp, "empty"));
		await fs.writeFile(path.join(tmp, "loose.md"), "x");
		expect(discoverSkills(tmp)).toEqual(["alpha", "zeta"]);
		expect(discoverSkills(path.join(tmp, "missing"))).toEqual([]);
	});
});

describe("setup plan", () => {
	it("has the exact MCP cleanup argv", () => {
		expect(MCP_CLEANUPS).toEqual([
			{ client: "claude", args: ["mcp", "remove", "-s", "user", "mdxserve"] },
			{ client: "codex", args: ["mcp", "remove", "mdxserve"] },
		]);
	});

	it("builds the skills install command", () => {
		expect(skillsInstallCommand("/pkg/skills")).toEqual({
			command: "npx",
			args: [
				"-y",
				"skills",
				"add",
				"/pkg/skills",
				"-g",
				"-a",
				"claude-code",
				"codex",
				"universal",
				"-s",
				"*",
				"-y",
			],
		});
	});

	it("plans skills first, then cleanups for available clients", () => {
		const steps = planSetup({
			skillsRoot: "/pkg/skills",
			hasSkills: true,
			available: new Set(["codex"]),
		});
		expect(steps.map((step) => step.command)).toEqual(["npx", "codex"]);
		expect(steps[0]).toMatchObject({ inherit: true, ignoreFailure: false });
		expect(steps[1]).toMatchObject({ inherit: false, ignoreFailure: true });
	});

	it("plans nothing when there are no skills and no clients", () => {
		expect(planSetup({ skillsRoot: "/x", hasSkills: false, available: new Set() })).toEqual([]);
	});
});
