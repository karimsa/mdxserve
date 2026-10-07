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
		for (const verb of ["validate", "search", "docs", "roots"]) {
			expect(result.stdout).toMatch(new RegExp(`^\\s+${verb}\\b`, "m"));
		}
		expect(result.stdout).not.toMatch(/^\s+mcp\b/m);
	}, 90_000);
});
