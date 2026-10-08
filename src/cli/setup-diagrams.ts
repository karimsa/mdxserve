import path from "node:path";
import type { SetupService } from "../setup/service.js";
import { createInterface } from "node:readline/promises";
import { mdxserveHome } from "../servers/server-registry.js";
import { PreferencesService, isDiagramAgent } from "../preferences/service.js";
import { localAgentPort } from "../diagrams/adapters/agents.js";
/** Terminal presentation only; preferences and detection are shared with the browser. */
export async function setupDiagrams(service: SetupService, choice?: string): Promise<void> {
	const preferences = new PreferencesService(path.join(mdxserveHome(), "config.json"));
	const interactive = choice === undefined && !!process.stdin.isTTY && !!process.stdout.isTTY;
	const existing = await service.prepareDiagrams(preferences, localAgentPort());
	if (existing.kind !== "ok") throw new Error(existing.message);
	let selected = choice ?? existing.fallback;
	if (selected === "auto") selected = existing.detected;
	if (selected !== undefined && !isDiagramAgent(selected))
		throw new Error("Use --diagram-agent auto, codex, claude or disabled");
	if (interactive) {
		const statuses = existing.statuses;
		console.log("\n==> AI Mermaid diagrams");
		for (const status of statuses) console.log(`${status.provider}: ${status.state}`);
		console.log(
			"Convert images and rough text using your agent account. Each settled input is sent to its provider.",
		);
		const prompt = createInterface({ input: process.stdin, output: process.stdout });
		try {
			const fallback = existing.fallback;
			do {
				selected =
					(await prompt.question(`Diagram agent [codex/claude/disabled] (${fallback}): `)).trim() ||
					fallback;
			} while (!isDiagramAgent(selected));
		} finally {
			prompt.close();
		}
	}
	if (selected !== undefined && isDiagramAgent(selected)) {
		const result = preferences.set(selected);
		if (result.kind !== "ok") throw new Error(result.message);
		console.log(`Diagram conversion: ${result.agent}`);
	} else
		console.log(
			`Diagram conversion: ${existing.configured ? existing.agent : "not configured (disabled)"}. Use --diagram-agent to change it.`,
		);
}
