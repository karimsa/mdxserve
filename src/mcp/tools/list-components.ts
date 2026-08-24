import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ComponentsService } from "../../components/service.js";
import type { McpContext } from "../server.js";
import { textResult, componentPropNames } from "../format.js";

const listComponentsInput = { query: z.string().optional() };

const listComponentsOutput = {
	components: z.array(
		z.object({
			name: z.string(),
			description: z.string(),
			whenToUse: z.string(),
			props: z.array(z.string()),
		}),
	),
};

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
			const matches = componentsService.list(query);
			const components = matches.map((component) => ({
				name: component.name,
				description: component.description,
				whenToUse: component.whenToUse,
				props: componentPropNames(component.props),
			}));

			const text =
				components.length === 0
					? `No components match "${query ?? ""}".`
					: (() => {
							const width = Math.max(...components.map((component) => component.name.length));
							return components
								.map((component) => `${component.name.padEnd(width)}  ${component.description}`)
								.join("\n");
						})();

			return textResult(text, { components });
		},
	);
}
