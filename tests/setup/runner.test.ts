import { describe, expect, it } from "vitest";
import { zxCommandRunner } from "../../src/setup/runner.js";

describe("zxCommandRunner", () => {
	const runner = zxCommandRunner();

	it("returns the exit code without throwing", async () => {
		const result = await runner.run(process.execPath, ["-e", "process.exit(3)"], {
			inherit: false,
		});
		expect(result.code).toBe(3);
	});

	it("captures stderr", async () => {
		const result = await runner.run(process.execPath, ["-e", "console.error('boom')"], {
			inherit: false,
		});
		expect(result.stderr).toContain("boom");
	});

	it("finds node and not a missing binary", async () => {
		expect(await runner.which("mdxserve-definitely-missing-xyz")).toBeUndefined();
		expect(typeof (await runner.which("node"))).toBe("string");
	});
});
