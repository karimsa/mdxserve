import { searchRegistry, suggest, type Registry, type RegistryComponent } from "./registry.js";

/**
 * The list view of a component: everything needed to choose one, with the
 * props reduced to their names. The full JSON Schema for each prop is an
 * order of magnitude larger and is only worth sending for the one component
 * a caller has settled on — that is what `find` is for.
 */
export interface ComponentSummary {
	name: string;
	description: string;
	whenToUse: string;
	props: string[];
}

/**
 * Thin lookup surface over the builtin component registry, shared by the CLI
 * (`mdxserve components`), the MCP tools, and the tRPC controller, so "find by
 * name", "reduce to a list row", and "suggest a typo fix" only live in one
 * place.
 */
export class ComponentsService {
	constructor(private readonly registry: Registry) {}

	/** Case-insensitive substring match over name, description, whenToUse, and prop names. */
	list(query?: string): RegistryComponent[] {
		return searchRegistry(this.registry, query);
	}

	/** `list`, reduced to the list view — see `ComponentSummary`. */
	listSummaries(query?: string): ComponentSummary[] {
		return this.list(query).map((component) => ({
			name: component.name,
			description: component.description,
			whenToUse: component.whenToUse,
			props: Object.keys((component.props?.properties as Record<string, unknown>) ?? {}),
		}));
	}

	/** Case-insensitive exact match by component name. */
	find(name: string): RegistryComponent | undefined {
		return this.registry.components.find(
			(component) => component.name.toLowerCase() === name.toLowerCase(),
		);
	}

	/** Up to 3 "did you mean" suggestions for an unrecognized component name. */
	suggest(name: string): string[] {
		return suggest(this.registry, name);
	}
}
