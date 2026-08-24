import fsp from "node:fs/promises";
import { validateSource, type ValidationResult } from "./validate.js";
import { importResolves } from "./paths.js";
import type { Registry } from "./registry.js";
import type { RenderOutcome } from "./render.js";

export interface ValidateDocAtOptions {
	registry: Registry;
	/** Server-side render step; omitted when the caller is not on loopback. */
	render?: (absPath: string) => Promise<RenderOutcome>;
}

/**
 * The same static + render validation the `validate_doc` MCP tool runs,
 * shared with the `validateDoc` tRPC procedure so the two paths can never
 * drift.
 */
export async function validateDocAt(
	absPath: string,
	opts: ValidateDocAtOptions,
): Promise<ValidationResult> {
	const source = await fsp.readFile(absPath, "utf8");
	return validateSource({
		source,
		path: absPath,
		registry: opts.registry,
		resolveImport: (specifier) => importResolves(absPath, specifier),
		render: opts.render,
	});
}
