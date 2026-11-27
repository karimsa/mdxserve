import os from "node:os";
import { z } from "zod";
import { readPackageVersion } from "../../infra/pkg.js";
import { runProcess } from "../../infra/process-runner.js";
import { isDiagramModel } from "../../preferences/service.js";
import type { AgentModel, Provider } from "../types.js";
import { environment } from "./environment.js";

const modelName = z.string().refine(isDiagramModel);
const codexPage = z.object({
	data: z
		.array(
			z.object({
				model: modelName,
				displayName: z.string().max(200),
				hidden: z.boolean().optional(),
			}),
		)
		.max(200),
	nextCursor: z.string().nullable().optional(),
});
const claudeCatalog = z.object({
	models: z.array(z.object({ value: modelName, displayName: z.string().max(200) })).max(200),
});
const line = (value: unknown) => JSON.stringify(value) + "\n";
/** Metadata only: no thread, prompt, generation or automatic model selection. */
export async function listAgentModels(
	provider: Provider,
	signal = new AbortController().signal,
): Promise<AgentModel[]> {
	const models: AgentModel[] = [];
	let finished = false;
	let pages = 0;
	let initialized = false;
	const args =
		provider === "codex"
			? ["app-server", "--listen", "stdio://"]
			: [
					"-p",
					"--input-format",
					"stream-json",
					"--output-format",
					"stream-json",
					"--verbose",
					"--tools",
					"",
					"--strict-mcp-config",
					"--mcp-config",
					'{"mcpServers":{}}',
					"--setting-sources",
					"",
					"--settings",
					'{"disableAllHooks":true}',
					"--disable-slash-commands",
					"--no-chrome",
					"--no-session-persistence",
					"--permission-mode",
					"dontAsk",
				];
	const initial =
		provider === "codex"
			? {
					id: "init",
					method: "initialize",
					params: { clientInfo: { name: "mdxserve", version: readPackageVersion() } },
				}
			: { type: "control_request", request_id: "models", request: { subtype: "initialize" } };
	const result = await runProcess(provider, args, {
		cwd: os.tmpdir(),
		signal,
		timeoutMs: 15000,
		env: environment(),
		input: line(initial),
		onLine(raw) {
			const event = JSON.parse(raw);
			if (provider === "codex") {
				if (event.id === "init") {
					if (event.error || initialized) throw new Error("Initialization failed");
					initialized = true;
					return {
						write:
							line({ method: "initialized" }) +
							line({ id: "models", method: "model/list", params: { limit: 100 } }),
					};
				}
				if (event.id !== "models") return;
				if (!initialized || event.error) throw new Error("Model catalog failed");
				const page = codexPage.parse(event.result);
				models.push(
					...page.data
						.filter((model) => !model.hidden)
						.map((model) => ({ id: model.model, label: model.displayName })),
				);
				if (page.nextCursor) {
					if (++pages >= 10) throw new Error("Too many model pages");
					return {
						write: line({
							id: "models",
							method: "model/list",
							params: { limit: 100, cursor: page.nextCursor },
						}),
					};
				}
			} else {
				if (event.type !== "control_response" || event.response?.request_id !== "models") return;
				if (event.response.subtype !== "success") throw new Error("Model catalog failed");
				const catalog = claudeCatalog.parse(event.response.response);
				models.push(
					...catalog.models.map((model) => ({
						id: model.value,
						label: model.value === "default" ? "CLI default" : model.displayName,
					})),
				);
			}
			finished = true;
			return { done: true };
		},
	});
	if (result.code !== 0 || !finished || !models.length)
		throw new Error("Could not load the CLI model catalog");
	return [...new Map(models.map((model) => [model.id, model])).values()];
}
