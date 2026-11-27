import path from "node:path";
import type { RootInfo } from "../roots/root-info.js";
import { expandHome } from "../roots/paths.js";
import type { LiveServer } from "../servers/mounted-roots.js";
import { NO_SERVER_MESSAGE } from "./format.js";
import { fail, ok, type CommandOutcome } from "./outcome.js";

interface RootsDeps {
	server: LiveServer;
	cwd: string;
	home: string;
}

/** Resolve a CLI-supplied directory the way the roots tRPC schema expects: absolute, against this process's cwd (not the server's). */
function resolveRootArg(dir: string, deps: Pick<RootsDeps, "cwd" | "home">): string {
	return path.resolve(deps.cwd, expandHome(dir, deps.home));
}

function dirListLines(dirs: string[]): string[] {
	return dirs.length === 0 ? ["(none)"] : [...dirs];
}

function rootsMutationLines(
	verb: "Added" | "Removed",
	changed: string[],
	mountedRoots: RootInfo[],
): string[] {
	return [
		...changed.map((dir) => `${verb} ${dir}`),
		"Now serving:",
		...dirListLines(mountedRoots.map((rootInfo) => rootInfo.dir)),
	];
}

export async function runRootsList(
	options: { json?: boolean },
	deps: Pick<RootsDeps, "server">,
): Promise<CommandOutcome> {
	if (!deps.server.serverRunning()) return fail(NO_SERVER_MESSAGE);
	const outcome = await deps.server.remote.listRoots();
	if (outcome.kind === "error") return fail(outcome.message);
	if (outcome.kind === "unavailable") return fail(NO_SERVER_MESSAGE);
	if (options.json) return ok([JSON.stringify(outcome.value, null, 2)]);
	return ok(dirListLines(outcome.value.roots.map((rootInfo) => rootInfo.dir)));
}

export async function runRootsAdd(
	dirs: string[],
	options: { json?: boolean },
	deps: RootsDeps,
): Promise<CommandOutcome> {
	if (!deps.server.serverRunning()) return fail(NO_SERVER_MESSAGE);
	const outcome = await deps.server.remote.addRoots(dirs.map((dir) => resolveRootArg(dir, deps)));
	if (outcome.kind === "error") return fail(outcome.message);
	if (outcome.kind === "unavailable") return fail(NO_SERVER_MESSAGE);
	if (options.json) return ok([JSON.stringify(outcome.value, null, 2)]);
	return ok(rootsMutationLines("Added", outcome.value.added, outcome.value.roots));
}

export async function runRootsRemove(
	dirs: string[],
	options: { json?: boolean },
	deps: RootsDeps,
): Promise<CommandOutcome> {
	if (!deps.server.serverRunning()) return fail(NO_SERVER_MESSAGE);
	const outcome = await deps.server.remote.removeRoots(
		dirs.map((dir) => resolveRootArg(dir, deps)),
	);
	if (outcome.kind === "error") return fail(outcome.message);
	if (outcome.kind === "unavailable") return fail(NO_SERVER_MESSAGE);
	if (options.json) return ok([JSON.stringify(outcome.value, null, 2)]);
	return ok(rootsMutationLines("Removed", outcome.value.removed, outcome.value.roots));
}
