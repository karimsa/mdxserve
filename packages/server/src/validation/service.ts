import type { MetadataPort } from "../docs/metadata-port.js";
import fsp from "node:fs/promises";
import { validateSource, type ValidationResult } from "./validate.js";
import { resolveDocPath } from "../roots/paths.js";
import type { RootInfo } from "../roots/root-info.js";
import type { Registry } from "../components/registry.js";

export type ValidateDocResult =
	| { kind: "ok"; result: ValidationResult }
	| { kind: "not-found"; message: string }
	| { kind: "unreadable"; message: string };

export interface ValidateTextInput {
	source: string;
	absPath: string;
}

/**
 * The same validation `mdxserve validate` runs,
 * shared with the `validateDoc` tRPC procedure so the two paths can never
 * drift.
 */
export class ValidationService {
	constructor(
		private readonly rootInfos: RootInfo[],
		private readonly registry: Registry,
		private readonly metadata: MetadataPort,
	) {}

	/**
	 * Resolve `input.path` under `rootInfos`, read it, and validate its
	 * contents.
	 */
	async validateDoc(input: { path: string }): Promise<ValidateDocResult> {
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

		const result = await this.validateText({ source, absPath: resolved.abs });
		return { kind: "ok", result };
	}

	/** Validate already-read `source` for `absPath`. */
	async validateText(input: ValidateTextInput): Promise<ValidationResult> {
		return validateSource({
			metadata: this.metadata,
			source: input.source,
			path: input.absPath,
			registry: this.registry,
		});
	}
}
