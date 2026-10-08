import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SetupService } from "../../src/setup/service.js";
import { PreferencesService } from "../../src/preferences/service.js";
import { fakeRunner } from "./fake-runner.js";
const folders: string[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});
it("detects a concrete agent during setup and preserves an existing explicit choice", async () => {
	const folder = fs.mkdtempSync(path.join(os.tmpdir(), "setup-diagram-"));
	folders.push(folder);
	const preferences = new PreferencesService(path.join(folder, "config.json"));
	const service = new SetupService({
		pkgRoot: folder,
		runner: fakeRunner({ available: new Set(), exitCodes: () => 0 }),
	});
	const agents = {
		models: async () => [],
		probe: vi.fn(async () => [{ provider: "claude" as const, state: "ready" as const }]),
		convert: vi.fn(),
	};
	expect(await service.prepareDiagrams(preferences, agents)).toMatchObject({
		fallback: "claude",
		configured: false,
	});
	expect(agents.probe).toHaveBeenCalledTimes(1);
	expect(await service.prepareDiagrams(preferences, agents)).toMatchObject({
		fallback: "claude",
	});
	preferences.set("disabled");
	expect(await service.prepareDiagrams(preferences, agents)).toMatchObject({
		fallback: "disabled",
		configured: true,
	});
	preferences.set("codex");
	expect(await service.prepareDiagrams(preferences, agents)).toMatchObject({
		fallback: "codex",
	});
});
