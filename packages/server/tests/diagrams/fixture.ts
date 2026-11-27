import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { PreferencesService } from "../../src/preferences/service.js";
import { DiagramsService } from "../../src/diagrams/service.js";
import type { AgentPort } from "../../src/diagrams/types.js";
export const draft = {
	mermaid: "erDiagram\n CUSTOMER ||--o{ ORDER : places",
	assumptions: [],
	changes: [],
};
export function fixture(agents?: AgentPort) {
	const folder = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-test-"));
	const preferences = new PreferencesService(path.join(folder, "config.json"));
	preferences.set("codex");
	const port = agents ?? {
		models: async () => [],
		probe: vi.fn(async () => [
			{ provider: "codex" as const, state: "ready" as const },
			{ provider: "claude" as const, state: "ready" as const },
		]),
		convert: vi.fn(async () => draft),
	};
	const validate = vi.fn(async () => null as string | null);
	return {
		preferences,
		port,
		validate,
		service: new DiagramsService(preferences, port, validate, async (bytes) => bytes),
		cleanup: () => fs.rmSync(folder, { recursive: true, force: true }),
	};
}
export const input = {
	session: "5522ed28-b45f-4b29-8d87-05468fc9b750",
	revision: 1,
	text: "customer has orders",
};
