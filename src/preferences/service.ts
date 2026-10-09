import { ensureConfig, readConfig, writeConfig } from "../infra/config.js";
export const DIAGRAM_AGENTS = ["codex", "claude", "disabled"] as const;
export const DEFAULT_DIAGRAM_MODELS = { codex: "gpt-6-luna", claude: "haiku" };
export type DiagramModels = typeof DEFAULT_DIAGRAM_MODELS;
export type DiagramAgent = (typeof DIAGRAM_AGENTS)[number];
export function isDiagramAgent(value: unknown): value is DiagramAgent {
	return DIAGRAM_AGENTS.some((agent) => agent === value);
}
export function isDiagramModel(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value);
}
function modelsFrom(value: unknown): DiagramModels | null {
	if (value === undefined) return { ...DEFAULT_DIAGRAM_MODELS };
	if (
		!value ||
		typeof value !== "object" ||
		!("codex" in value) ||
		!("claude" in value) ||
		!isDiagramModel(value.codex) ||
		!isDiagramModel(value.claude)
	)
		return null;
	return { codex: value.codex, claude: value.claude };
}
export type PreferenceResult =
	| { kind: "ok"; agent: DiagramAgent; configured: boolean; models: DiagramModels }
	| { kind: "error"; message: string };
export class PreferencesService {
	constructor(private readonly file: string) {}
	read(): PreferenceResult {
		try {
			ensureConfig(this.file);
			const value = readConfig(this.file).value.diagrams;
			if (value === undefined)
				return {
					kind: "ok",
					agent: "disabled",
					configured: false,
					models: { ...DEFAULT_DIAGRAM_MODELS },
				};
			if (
				!value ||
				typeof value !== "object" ||
				!("agent" in value) ||
				(!isDiagramAgent(value.agent) && value.agent !== "auto")
			)
				return { kind: "error", message: "Invalid diagrams.agent in mdxserve config" };
			const models = modelsFrom("models" in value ? value.models : undefined);
			if (!models) return { kind: "error", message: "Invalid diagrams.models in mdxserve config" };
			// Legacy Auto requires an explicit setup/detection action; never probe during conversion.
			return {
				kind: "ok",
				agent: value.agent === "auto" ? "disabled" : value.agent,
				configured: value.agent !== "auto",
				models,
			};
		} catch {
			return { kind: "error", message: "Could not read mdxserve preferences" };
		}
	}
	set(agent: DiagramAgent, models?: DiagramModels): PreferenceResult {
		if (!isDiagramAgent(agent)) return { kind: "error", message: "Unknown diagram agent" };
		if (!modelsFrom(models)) return { kind: "error", message: "Invalid diagram models" };
		try {
			ensureConfig(this.file);
			const snapshot = readConfig(this.file);
			const previous = snapshot.value.diagrams;
			const fields = previous && typeof previous === "object" ? { ...previous } : {};
			if ("liveConversion" in fields) delete fields.liveConversion;
			const savedModels = models ?? modelsFrom("models" in fields ? fields.models : undefined);
			if (!savedModels) return { kind: "error", message: "Invalid diagram models" };
			writeConfig(this.file, snapshot, { diagrams: { ...fields, agent, models: savedModels } });
			return this.read();
		} catch {
			return { kind: "error", message: "Could not save preferences; check the config and retry" };
		}
	}
}
