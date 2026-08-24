import { searchRegistry, suggest, type Registry, type RegistryComponent } from "./registry.js";

/**
 * Thin lookup surface over the builtin component registry, shared by the CLI
 * (`mdxserve components`), the MCP tools, and (later) a tRPC controller, so
 * "find by name" and "suggest a typo fix" only live in one place.
 */
export class ComponentsService {
	constructor(private readonly registry: Registry) {}

	/** Case-insensitive substring match over name, description, whenToUse, and prop names. */
	list(query?: string): RegistryComponent[] {
		return searchRegistry(this.registry, query);
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
