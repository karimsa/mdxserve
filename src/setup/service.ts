import path from "node:path";
import type { PreferencesService, PreferenceResult } from "../preferences/service.js";
import type { AgentPort } from "../diagrams/types.js";
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
	private readonly diagramSetups = new WeakMap<PreferencesService, Promise<PreferenceResult>>();

	constructor(options: { pkgRoot: string; runner: CommandRunner }) {
		this.pkgRoot = options.pkgRoot;
		this.runner = options.runner;
	}

	async configureDiagrams(
		preferences: PreferencesService,
		agents: AgentPort,
	): Promise<PreferenceResult> {
		const pending = this.diagramSetups.get(preferences);
		if (pending) return pending;
		const work = this.initializeDiagrams(preferences, agents);
		this.diagramSetups.set(preferences, work);
		try {
			return await work;
		} finally {
			this.diagramSetups.delete(preferences);
		}
	}

	private async initializeDiagrams(
		preferences: PreferencesService,
		agents: AgentPort,
	): Promise<PreferenceResult> {
		const existing = preferences.read();
		if (existing.kind !== "ok" || existing.configured) return existing;
		try {
			const statuses = await agents.probe();
			// A Settings save during detection takes precedence over setup's suggestion.
			const latest = preferences.read();
			if (latest.kind !== "ok" || latest.configured) return latest;
			const detected = statuses.find((status) => status.state === "ready")?.provider ?? "disabled";
			return preferences.set(detected, latest.models);
		} catch {
			return { kind: "error", message: "Could not check local agents" };
		}
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
