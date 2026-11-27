import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SetupService } from "../../src/setup/service.js";
import { DIAGRAM_AGENTS, PreferencesService } from "../../src/preferences/service.js";
import type { AgentStatus } from "../../src/diagrams/types.js";
import { fakeRunner } from "./fake-runner.js";
const folders: string[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});
function fixture() {
	const folder = fs.mkdtempSync(path.join(os.tmpdir(), "setup-diagram-"));
	folders.push(folder);
	const file = path.join(folder, "config.json");
	const preferences = new PreferencesService(file);
	const service = new SetupService({
		pkgRoot: folder,
		runner: fakeRunner({ available: new Set(), exitCodes: () => 0 }),
	});
	const agents = {
		models: vi.fn(async () => []),
		probe: vi.fn(async (): Promise<AgentStatus[]> => [{ provider: "claude", state: "ready" }]),
		convert: vi.fn(),
	};
	return { file, preferences, service, agents };
}
it("automatically initializes missing preferences once, including overlapping calls", async () => {
	const { file, preferences, service, agents } = fixture();
	const save = vi.spyOn(preferences, "set");
	const results = await Promise.all([
		service.configureDiagrams(preferences, agents),
		service.configureDiagrams(preferences, agents),
	]);
	for (const result of results)
		expect(result).toMatchObject({ kind: "ok", agent: "claude", configured: true });
	const saved = fs.readFileSync(file, "utf8");
	await service.configureDiagrams(preferences, agents);
	expect(agents.probe).toHaveBeenCalledTimes(1);
	expect(save).toHaveBeenCalledTimes(1);
	expect(fs.readFileSync(file, "utf8")).toBe(saved);
	expect(agents.models).not.toHaveBeenCalled();
	expect(agents.convert).not.toHaveBeenCalled();
});
it.each(DIAGRAM_AGENTS)(
	"preserves configured %s and model overrides without probing or writing",
	async (agent) => {
		const { preferences, service, agents } = fixture();
		const models = { codex: "custom-codex", claude: "custom-claude" };
		preferences.set(agent, models);
		const save = vi.spyOn(preferences, "set");
		expect(await service.configureDiagrams(preferences, agents)).toMatchObject({
			kind: "ok",
			agent,
			models,
		});
		expect(agents.probe).not.toHaveBeenCalled();
		expect(save).not.toHaveBeenCalled();
	},
);
it("initializes Disabled when no agent is ready without repeating work on rerun", async () => {
	const { preferences, service, agents } = fixture();
	agents.probe.mockResolvedValue([{ provider: "codex", state: "signed-out" }]);
	expect(await service.configureDiagrams(preferences, agents)).toMatchObject({
		agent: "disabled",
		configured: true,
	});
	await service.configureDiagrams(preferences, agents);
	expect(agents.probe).toHaveBeenCalledTimes(1);
});
it("preserves settings saved while detection was in progress", async () => {
	const { preferences, service, agents } = fixture();
	agents.probe.mockImplementation(async () => {
		preferences.set("disabled");
		return [{ provider: "claude", state: "ready" }];
	});
	expect(await service.configureDiagrams(preferences, agents)).toMatchObject({
		agent: "disabled",
		configured: true,
	});
});
it("allows retry after detection failure without saving a partial setup", async () => {
	const { preferences, service, agents } = fixture();
	agents.probe.mockRejectedValueOnce(new Error("unavailable"));
	expect(await service.configureDiagrams(preferences, agents)).toMatchObject({ kind: "error" });
	expect(preferences.read()).toMatchObject({ configured: false });
	expect(await service.configureDiagrams(preferences, agents)).toMatchObject({
		agent: "claude",
		configured: true,
	});
});
