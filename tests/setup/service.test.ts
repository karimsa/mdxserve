import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SetupService } from "../../src/setup/service.js";
import { fakeRunner } from "./fake-runner.js";

let pkgRoot: string | undefined;
afterEach(async () => {
	if (pkgRoot) await fs.rm(pkgRoot, { recursive: true, force: true });
	pkgRoot = undefined;
});

async function makePkg(skills: string[]): Promise<string> {
	pkgRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-setup-"));
	for (const name of skills) {
		await fs.mkdir(path.join(pkgRoot, "skills", name), { recursive: true });
		await fs.writeFile(path.join(pkgRoot, "skills", name, "SKILL.md"), "x");
	}
	return pkgRoot;
}

describe("SetupService", () => {
	it("installs skills and removes old MCP registrations", async () => {
		const root = await makePkg(["mdxserve"]);
		const runner = fakeRunner({ available: new Set(["claude", "codex"]), exitCodes: () => 0 });
		const result = await new SetupService({ pkgRoot: root, runner }).run();
		expect(result).toEqual({
			kind: "ok",
			skills: "installed",
			cleanups: [
				{ client: "claude", status: "removed" },
				{ client: "codex", status: "removed" },
			],
		});
		expect(runner.log.map((call) => call.command)).toEqual(["npx", "claude", "codex"]);
	});

	it("reports an error with stderr when the skills install fails", async () => {
		const root = await makePkg(["mdxserve"]);
		const runner = fakeRunner({ available: new Set(["claude"]), exitCodes: () => 2 });
		const result = await new SetupService({ pkgRoot: root, runner }).run();
		expect(result).toEqual({
			kind: "error",
			message: "installing skills failed (npx skills add exited 2)\nline1\nboom",
		});
		expect(runner.log).toHaveLength(1);
	});

	it("skips skills when none ship and marks missing clients", async () => {
		const root = await makePkg([]);
		const runner = fakeRunner({ available: new Set(), exitCodes: () => 0 });
		const result = await new SetupService({ pkgRoot: root, runner }).run();
		expect(result).toEqual({
			kind: "ok",
			skills: "none",
			cleanups: [
				{ client: "claude", status: "not-installed" },
				{ client: "codex", status: "not-installed" },
			],
		});
		expect(runner.log).toEqual([]);
	});

	it("treats a failing cleanup as absent", async () => {
		const root = await makePkg([]);
		const runner = fakeRunner({ available: new Set(["codex"]), exitCodes: () => 1 });
		const result = await new SetupService({ pkgRoot: root, runner }).run();
		expect(result).toMatchObject({
			kind: "ok",
			cleanups: [
				{ client: "claude", status: "not-installed" },
				{ client: "codex", status: "absent" },
			],
		});
	});
});
