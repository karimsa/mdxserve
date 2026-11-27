import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tailscaleRunner } from "../../src/tailscale/runner.js";

let dir: string;

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "mdxserve-tailscale-runner-"));
});

afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("tailscaleRunner", () => {
	// The macOS app's binary hangs as the GUI without this, when no terminal is in its environment.
	it("tells the binary to act as the CLI", async () => {
		const cli = path.join(dir, "print-env");
		await fs.writeFile(cli, "#!/bin/sh\nprintf '%s' \"$TAILSCALE_BE_CLI\"\n", { mode: 0o755 });
		expect(await tailscaleRunner()(cli, [])).toEqual({ code: 0, stdout: "1" });
	});

	it("keeps ENOENT for a missing executable", async () => {
		await expect(tailscaleRunner()(path.join(dir, "missing"), [])).rejects.toMatchObject({
			code: "ENOENT",
		});
	});
});
