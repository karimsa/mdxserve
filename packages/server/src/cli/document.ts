import path from "node:path";
import type { Registry } from "../components/registry.js";
import { documentResultSchema } from "../docs/controller.js";
import { DocsService } from "../docs/service.js";
import type { TocEntry } from "../document/schema.js";
import { expandHome } from "../roots/paths.js";
import { RootsService } from "../roots/service.js";
import { fail, ok, type CommandOutcome } from "./outcome.js";

export interface DocumentDeps {
	registry: Registry;
	cwd: string;
	home: string;
}

/**
 * Parse one doc into the JSON tree a client receives from `getDocument`,
 * locally, with no server. `--json` prints the tree; without it the table of
 * contents is printed with the id (the URL anchor) of each entry.
 */
export async function runDocument(
	input: string,
	options: { json?: boolean },
	deps: DocumentDeps,
): Promise<CommandOutcome> {
	const abs = path.resolve(deps.cwd, expandHome(input, deps.home));
	// An absolute path resolves with no mounted roots, so this never needs a server.
	const docs = new DocsService(new RootsService(deps.cwd, deps.home, []), deps.registry);
	const result = await docs.readDocument(abs);
	switch (result.kind) {
		case "not-found":
			return fail(result.message);
		case "too-large":
			return fail(`${abs} is too large to parse`);
		case "ok":
			break;
		default: {
			const exhaustiveResult: never = result;
			throw new Error(`Unhandled readDocument result: ${JSON.stringify(exhaustiveResult)}`);
		}
	}
	const { document } = documentResultSchema.parse({
		document: result.document,
		version: result.version,
	});
	if (options.json) return ok([JSON.stringify(document, null, 2)]);

	const title = document.metadata.title ?? path.basename(abs);
	const lines = [`${title} (${abs})`, ...formatToc(document.toc, 1)];
	if (document.toc.length === 0) lines.push("  (no table of contents entries)");
	return ok([lines.join("\n")]);
}

function formatToc(entries: TocEntry[], depth: number): string[] {
	return entries.flatMap((entry) => [
		`${"  ".repeat(depth)}${entry.kind === "tab" ? "[tab] " : ""}${entry.label}  #${entry.id}`,
		...formatToc(entry.children, depth + 1),
	]);
}
