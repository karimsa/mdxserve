import fs from "node:fs";
import path from "node:path";

/** Names of subdirectories of `skillsRoot` that contain a SKILL.md, sorted. */
export function discoverSkills(skillsRoot: string): string[] {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.filter(
			(entry) =>
				entry.isDirectory() && fs.existsSync(path.join(skillsRoot, entry.name, "SKILL.md")),
		)
		.map((entry) => entry.name)
		.sort();
}

export function skillsInstallCommand(skillsRoot: string): { command: "npx"; args: string[] } {
	return {
		command: "npx",
		args: [
			"-y",
			"skills",
			"add",
			skillsRoot,
			"-g",
			"-a",
			"claude-code",
			"codex",
			"universal",
			"-s",
			"*",
			"-y",
		],
	};
}

export interface McpCleanup {
	client: "claude" | "codex";
	args: string[];
}

/** Removes the MCP registration that older mdxserve versions created. */
export const MCP_CLEANUPS: readonly McpCleanup[] = [
	{ client: "claude", args: ["mcp", "remove", "-s", "user", "mdxserve"] },
	{ client: "codex", args: ["mcp", "remove", "mdxserve"] },
];

export interface SetupStep {
	command: string;
	args: string[];
	inherit: boolean;
	ignoreFailure: boolean;
}

export function planSetup(options: {
	skillsRoot: string;
	hasSkills: boolean;
	available: ReadonlySet<string>;
}): SetupStep[] {
	const steps: SetupStep[] = [];
	if (options.hasSkills) {
		const { command, args } = skillsInstallCommand(options.skillsRoot);
		steps.push({ command, args, inherit: true, ignoreFailure: false });
	}
	for (const cleanup of MCP_CLEANUPS) {
		if (!options.available.has(cleanup.client)) continue;
		steps.push({
			command: cleanup.client,
			args: [...cleanup.args],
			inherit: false,
			ignoreFailure: true,
		});
	}
	return steps;
}
