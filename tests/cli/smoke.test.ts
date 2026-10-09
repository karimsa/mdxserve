import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

describe("mdxserve --help", () => {
	it("lists the agent-facing verbs", () => {
		const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "--help"], {
			cwd: repoRoot,
			encoding: "utf8",
			timeout: 60_000,
		});
		expect(result.status).toBe(0);
		for (const verb of ["validate", "search", "docs", "roots", "setup"]) {
			expect(result.stdout).toMatch(new RegExp(`^\\s+${verb}\\b`, "m"));
		}
		expect(result.stdout).not.toMatch(/^\s+mcp\b/m);
	}, 90_000);
});

it("exposes permissions mode and requires a root for default network access", () => {
	const help = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "serve", "--help"], {
		cwd: repoRoot,
		encoding: "utf8",
		timeout: 60_000,
	});
	expect(help.status).toBe(0);
	expect(help.stdout).toContain("--permissions <mode>");

	const missingRoot = spawnSync(
		process.execPath,
		["--import", "tsx", "src/index.ts", "serve", "--host", "0.0.0.0"],
		{ cwd: repoRoot, encoding: "utf8", timeout: 60_000 },
	);
	expect(missingRoot.status).toBe(1);
	expect(missingRoot.stderr).toContain(
		"restricted permissions require exactly one explicit -w directory",
	);
}, 90_000);

it("rejects an unknown permissions mode and full network access without opt-in", () => {
	for (const [argumentsList, expected] of [
		[["--permissions", "sandbox"], "invalid permissions mode"],
		[["--host", "0.0.0.0", "--permissions", "full"], "--dangerous-allow-network"],
	] as const) {
		const result = spawnSync(
			process.execPath,
			["--import", "tsx", "src/index.ts", "serve", ...argumentsList],
			{ cwd: repoRoot, encoding: "utf8", timeout: 60_000 },
		);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(expected);
	}
}, 90_000);
