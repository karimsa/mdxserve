import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatComponent } from "../../components/registry.js";
import { ComponentsService } from "../../components/service.js";
import { getComponentResultSchema } from "../../components/controller.js";
import type { McpContext } from "../server.js";
import { errorResult, textResult } from "../format.js";

const showComponentInput = { name: z.string().min(1) };

// Kept in lockstep with the `getComponent` tRPC procedure's output.
const showComponentOutput = getComponentResultSchema.shape;

export function registerShowComponent(server: McpServer, ctx: McpContext): void {
	const componentsService = new ComponentsService(ctx.registry);

	server.registerTool(
		"show_component",
		{
			title: "Show a builtin component",
			description:
				"Show full details (description, when to use it, and its props table with types/required/defaults) for one builtin MDX component, looked up case-insensitively by name. Call this before using a component you haven't used yet, to get its exact prop names and types.",
			inputSchema: showComponentInput,
			outputSchema: showComponentOutput,
		},
		async ({ name }) => {
			const entry = componentsService.find(name);
			if (!entry) {
				const suggestions = componentsService.suggest(name);
				const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
				return errorResult(`Unknown component "${name}".${hint}`);
			}
			return textResult(formatComponent(entry), { component: entry });
		},
	);
}
