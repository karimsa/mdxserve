import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it, expect } from "vitest";
import { assert, property, constantFrom, array, string } from "fast-check";
import { PreferencesService, DIAGRAM_AGENTS } from "../../src/preferences/service.js";
it("round trips all choices without changing roots", () => {
	assert(
		property(constantFrom(...DIAGRAM_AGENTS), array(string({ minLength: 1 })), (agent, roots) => {
			const folder = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-property-"));
			try {
				const file = path.join(folder, "config.json");
				fs.writeFileSync(file, JSON.stringify({ roots }));
				const preferences = new PreferencesService(file);
				expect(preferences.set(agent)).toEqual({
					kind: "ok",
					agent,
					configured: true,
					models: { codex: "gpt-6-luna", claude: "haiku" },
				});
				expect(preferences.read()).toEqual({
					kind: "ok",
					agent,
					configured: true,
					models: { codex: "gpt-6-luna", claude: "haiku" },
				});
				expect(JSON.parse(fs.readFileSync(file, "utf8")).roots).toEqual(roots);
			} finally {
				fs.rmSync(folder, { recursive: true, force: true });
			}
		}),
		{ numRuns: 30 },
	);
});
