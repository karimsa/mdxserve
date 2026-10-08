import path from "node:path";
import { discoverSkills, MCP_CLEANUPS, planSetup } from "./plan.js";
import type { CommandRunner } from "./runner.js";

export type CleanupStatus = "removed" | "absent" | "not-installed";

export type SetupResult =
	| {
			kind: "ok";
			skills: "installed" | "none";
			cleanups: { client: string; status: CleanupStatus }[];
	  }
	| { kind: "error"; message: string };

const STDERR_TAIL_LINES = 5;

export class SetupService {
	private readonly pkgRoot: string;
	private readonly runner: CommandRunner;

	constructor(options: { pkgRoot: string; runner: CommandRunner }) {
		this.pkgRoot = options.pkgRoot;
		this.runner = options.runner;
	}

	async run(): Promise<SetupResult> {
		const skillsRoot = path.join(this.pkgRoot, "skills");
		const hasSkills = discoverSkills(skillsRoot).length > 0;

		const available = new Set<string>();
		for (const cleanup of MCP_CLEANUPS) {
			if ((await this.runner.which(cleanup.client)) !== undefined) available.add(cleanup.client);
		}

		const statuses = new Map<string, CleanupStatus>();
		for (const step of planSetup({ skillsRoot, hasSkills, available })) {
			const result = await this.runner.run(step.command, step.args, { inherit: step.inherit });
			if (step.ignoreFailure) {
				statuses.set(step.command, result.code === 0 ? "removed" : "absent");
			} else if (result.code !== 0) {
				const tail = result.stderr.trim().split("\n").slice(-STDERR_TAIL_LINES).join("\n");
				const base = `installing skills failed (npx skills add exited ${result.code})`;
				return { kind: "error", message: tail ? `${base}\n${tail}` : base };
			}
		}

		return {
			kind: "ok",
			skills: hasSkills ? "installed" : "none",
			cleanups: MCP_CLEANUPS.map((cleanup) => ({
				client: cleanup.client,
				status: statuses.get(cleanup.client) ?? "not-installed",
			})),
		};
	}
}
