import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatComponentTable } from "../../components/registry.js";
import { ComponentsService } from "../../components/service.js";
import { listComponentsResultSchema } from "../../components/controller.js";
import type { McpContext } from "../server.js";
import { textResult } from "../format.js";

const listComponentsInput = { query: z.string().optional() };

// Kept in lockstep with the `listComponents` tRPC procedure's output — this
// tool and that procedure are the same query behind two transports.
const listComponentsOutput = listComponentsResultSchema.shape;

export function registerListComponents(server: McpServer, ctx: McpContext): void {
	const componentsService = new ComponentsService(ctx.registry);

	server.registerTool(
		"list_components",
		{
			title: "List builtin components",
			description:
				"List (optionally filtering by a case-insensitive substring match against name, description, whenToUse, and prop names) the builtin MDX components available to authors, e.g. Callout, Badge, Tabs. Call this to discover what components exist before writing or reviewing MDX.",
			inputSchema: listComponentsInput,
			outputSchema: listComponentsOutput,
		},
		async ({ query }) => {
			const components = componentsService.listSummaries(query);
			const text =
				components.length === 0
					? `No components match "${query ?? ""}".`
					: formatComponentTable(components);
			return textResult(text, { components });
		},
	);
}
