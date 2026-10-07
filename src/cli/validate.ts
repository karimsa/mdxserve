import path from "node:path";
import type { Registry } from "../components/registry.js";
import { expandHome } from "../roots/paths.js";
import { mountedRoots, type LiveServer } from "../servers/mounted-roots.js";
import { ValidationService } from "../validation/service.js";
import type { ValidationResult } from "../validation/validate.js";
import { formatValidationResult } from "./format.js";
import { fail, type CommandOutcome } from "./outcome.js";

export interface ValidateDeps {
	registry: Registry;
	server: LiveServer;
	cwd: string;
	home: string;
}

export type ValidateJsonEntry = ValidationResult | { path: string; error: string };

export async function runValidate(
	inputs: string[],
	options: { json?: boolean },
	deps: ValidateDeps,
): Promise<CommandOutcome> {
	const mounted = await mountedRoots(deps.server);
	if (mounted.kind === "error") return fail(mounted.message);
	// An absolute path needs no root to resolve against, so the static checks
	// still run with no server (or no roots) at all.
	const roots = mounted.kind === "ok" ? mounted.roots : [];
	const staticService = new ValidationService(roots, deps.registry);
	const serverRegistered = mounted.kind === "ok";

	const entries: ValidateJsonEntry[] = [];
	for (const input of inputs) {
		const abs = path.resolve(deps.cwd, expandHome(input, deps.home));
		entries.push(await validateOne(abs, serverRegistered, deps, staticService));
	}

	const hasFailure = entries.some((entry) => "error" in entry);
	const hasErrorDiagnostic = entries.some(
		(entry) =>
			"diagnostics" in entry &&
			entry.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
	);
	const exitCode = hasFailure || hasErrorDiagnostic ? 1 : 0;

	if (options.json) {
		return { exitCode, stdout: [JSON.stringify(entries, null, 2)], stderr: [] };
	}

	const blocks = entries.map((entry) =>
		"error" in entry
			? `Not validated: ${entry.path}\n  ${entry.error}`
			: formatValidationResult(entry),
	);
	const stdout = [blocks.join("\n\n")];
	if (entries.length > 1) stdout.push("", summaryLine(entries));
	return { exitCode, stdout, stderr: [] };
}

async function validateOne(
	abs: string,
	serverRegistered: boolean,
	deps: ValidateDeps,
	staticService: ValidationService,
): Promise<ValidateJsonEntry> {
	if (serverRegistered) {
		const remoteOutcome = await deps.server.remote.validateDoc(abs);
		if (remoteOutcome.kind === "ok") return remoteOutcome.value;
		if (remoteOutcome.kind === "error") return { path: abs, error: remoteOutcome.message };
		// unavailable: fall through to the static-only path below.
	}
	// No render function is ever passed, so this never starts a server or Vite.
	const outcome = await staticService.validateDoc({ path: abs, allowRender: false });
	switch (outcome.kind) {
		case "ok":
			return outcome.result;
		case "not-found":
		case "unreadable":
			return { path: abs, error: outcome.message };
		default: {
			const exhaustiveOutcome: never = outcome;
			throw new Error(`Unhandled validateDoc outcome: ${JSON.stringify(exhaustiveOutcome)}`);
		}
	}
}

function summaryLine(entries: ValidateJsonEntry[]): string {
	let okCount = 0;
	let warnCount = 0;
	let errorCount = 0;
	let notValidated = 0;
	for (const entry of entries) {
		if ("error" in entry) notValidated++;
		else if (!entry.ok) errorCount++;
		else if (entry.diagnostics.length > 0) warnCount++;
		else okCount++;
	}
	return `${entries.length} files: ${okCount} ok, ${warnCount} with warnings, ${errorCount} with errors, ${notValidated} not validated`;
}
