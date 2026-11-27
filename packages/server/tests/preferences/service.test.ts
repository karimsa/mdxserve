import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { PreferencesService } from "../../src/preferences/service.js";
import { readConfig, writeConfig } from "../../src/roots/config.js";
const folders: string[] = [];
afterEach(() => {
	for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});
function fixture() {
	const folder = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-prefs-"));
	folders.push(folder);
	const file = path.join(folder, "config.json");
	return { file, preferences: new PreferencesService(file) };
}
it("defaults to unconfigured and disabled", () => {
	expect(fixture().preferences.read()).toEqual({
		kind: "ok",
		agent: "disabled",
		configured: false,
		models: { codex: "gpt-6-luna", claude: "haiku" },
	});
});
it("preserves roots and unknown fields in both directions", () => {
	const { file, preferences } = fixture();
	fs.writeFileSync(file, JSON.stringify({ roots: ["/docs"], other: 123 }));
	expect(preferences.set("claude").kind).toBe("ok");
	writeConfig(file, readConfig(file), ["/other"]);
	expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
		roots: ["/other"],
		other: 123,
		diagrams: { agent: "claude", models: { codex: "gpt-6-luna", claude: "haiku" } },
	});
});
it("refuses to overwrite a corrupt config", () => {
	const { file, preferences } = fixture();
	fs.writeFileSync(file, "bad");
	expect(preferences.set("codex").kind).toBe("error");
	expect(fs.readFileSync(file, "utf8")).toBe("bad");
});

it("preserves model overrides when changing agents", () => {
	const { preferences } = fixture();
	const models = { codex: "custom-codex", claude: "sonnet" };
	expect(preferences.set("codex", models)).toMatchObject({ models });
	expect(preferences.set("claude")).toMatchObject({ agent: "claude", models });
});
it("requires explicit selection for legacy auto and discards the old toggle on save", () => {
	const { file, preferences } = fixture();
	fs.writeFileSync(
		file,
		JSON.stringify({ roots: [], diagrams: { agent: "auto", liveConversion: false } }),
	);
	expect(preferences.read()).toMatchObject({ agent: "disabled", configured: false });
	preferences.set("codex");
	expect(JSON.parse(fs.readFileSync(file, "utf8")).diagrams).not.toHaveProperty("liveConversion");
});
it("rejects empty or malformed model names without changing preferences", () => {
	const { preferences } = fixture();
	preferences.set("claude");
	for (const model of ["", "--bad", "model\nextra", "model with spaces"]) {
		expect(preferences.set("codex", { codex: model, claude: "haiku" }).kind).toBe("error");
	}
	expect(preferences.read()).toMatchObject({ agent: "claude" });
});
