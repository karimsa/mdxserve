import path from "node:path";
import type { SetupService } from "../setup/service.js";
import { mdxserveHome } from "../servers/server-registry.js";
import { PreferencesService } from "../preferences/service.js";
import { localAgentPort } from "../diagrams/adapters/agents.js";
/** Terminal presentation only; setup owns detection and initialization. */
export async function setupDiagrams(service: SetupService): Promise<void> {
	const preferences = new PreferencesService(path.join(mdxserveHome(), "config.json"));
	const result = await service.configureDiagrams(preferences, localAgentPort());
	if (result.kind !== "ok") throw new Error(result.message);
	console.log(`Diagram conversion: ${result.agent}. Change agent or model in Settings → Diagrams.`);
}
