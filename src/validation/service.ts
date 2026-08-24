import fsp from "node:fs/promises";
import { validateSource, type ValidationResult } from "./validate.js";
import { resolveDocPath, importResolves } from "../roots/paths.js";
import type { RootInfo } from "../roots/root-info.js";
import type { Registry } from "../components/registry.js";
import type { RenderPort } from "../rendering/protocol.js";

export type ValidateDocResult =
	| { kind: "ok"; result: ValidationResult }
	| { kind: "not-found"; message: string }
	| { kind: "unreadable"; message: string };

export interface ValidateTextInput {
	source: string;
	absPath: string;
	allowRender?: boolean;
}

/**
 * The same static + render validation the `validate_doc` MCP tool runs,
 * shared with the `validateDoc` tRPC procedure so the two paths can never
 * drift.
 */
export class ValidationService {
	constructor(
		private readonly rootInfos: RootInfo[],
		private readonly registry: Registry,
		private readonly render?: RenderPort,
	) {}

	/**
	 * Resolve `input.path` under `rootInfos`, read it, and validate its
	 * contents. `allowRender` is required (fail closed): only same-machine
	 * callers may run the render step.
	 */
	async validateDoc(input: { path: string; allowRender: boolean }): Promise<ValidateDocResult> {
		const rootDirs = this.rootInfos.map((rootInfo) => rootInfo.dir);
		const resolved = await resolveDocPath(rootDirs, input.path);
		if (!resolved.ok) return { kind: "not-found", message: resolved.error };

		let source: string;
		try {
			source = await fsp.readFile(resolved.abs, "utf8");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { kind: "unreadable", message: `Failed to read ${resolved.abs}: ${message}` };
		}

		const result = await this.validateText({
			source,
			absPath: resolved.abs,
			allowRender: input.allowRender,
		});
		return { kind: "ok", result };
	}

	/** Validate already-read `source` for `absPath`; render only when `allowRender` is true. */
	async validateText(input: ValidateTextInput): Promise<ValidationResult> {
		return validateSource({
			source: input.source,
			path: input.absPath,
			registry: this.registry,
			resolveImport: (specifier) => importResolves(input.absPath, specifier),
			render: input.allowRender ? this.render : undefined,
		});
	}
}
