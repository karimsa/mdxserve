import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decideBuild } from "../../scripts/vercel-ignore-build";

const script = resolve(import.meta.dirname, "../../scripts/vercel-ignore-build.ts");

function onBranch(changedPaths: readonly string[] | undefined) {
	return decideBuild({ branch: "feature", environment: "preview", changedPaths });
}

describe("decideBuild", () => {
	it("builds a change to the site", () => {
		expect(onBranch(["apps/site/src/pages/Home.tsx"])).toEqual({
			build: true,
			reason: "apps/site/src/pages/Home.tsx changed: building",
		});
	});

	it("skips a change to the server only", () => {
		expect(onBranch(["packages/server/src/http/start.ts", "docs/development.md"]).build).toBe(
			false,
		);
	});

	it("skips a change to the app, the web client and the shared components", () => {
		expect(
			onBranch([
				"apps/mobile/app/index.tsx",
				"apps/web/src/entry.tsx",
				"packages/ui/src/tokens/colors.ts",
				"CHANGELOG.md",
			]).build,
		).toBe(false);
	});

	it("builds a change to what the root install reads", () => {
		for (const path of [
			"yarn.lock",
			"package.json",
			".yarnrc.yml",
			".yarn/patches/some.patch",
			"apps/mobile/package.json",
			"packages/server/package.json",
		]) {
			expect(onBranch(["apps/mobile/app/index.tsx", path]).build, path).toBe(true);
		}
	});

	it("builds a change to vercel.json", () => {
		expect(onBranch(["vercel.json"]).build).toBe(true);
	});

	it("does not mistake a nested package.json or a similar folder for a build input", () => {
		expect(
			onBranch(["apps/web/tests/fixtures/package.json", "apps/site-old/index.html"]).build,
		).toBe(false);
	});

	it("builds when there is no comparison base", () => {
		expect(onBranch(undefined)).toEqual({ build: true, reason: "no comparison base: building" });
	});

	it("always builds main, which the release workflow promotes", () => {
		expect(decideBuild({ branch: "main", environment: undefined, changedPaths: [] }).build).toBe(
			true,
		);
		expect(
			decideBuild({
				branch: "main",
				environment: "production",
				changedPaths: ["packages/server/package.json"],
			}).build,
		).toBe(true);
		expect(
			decideBuild({ branch: undefined, environment: "production", changedPaths: [] }).build,
		).toBe(true);
	});
});

describe("the ignore command", () => {
	const repositories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			repositories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
		);
	});

	function git(repository: string, ...argumentsList: string[]): string {
		return execFileSync("git", argumentsList, { cwd: repository, encoding: "utf8" }).trim();
	}

	async function commitFile(repository: string, path: string): Promise<string> {
		await mkdir(dirname(resolve(repository, path)), { recursive: true });
		await writeFile(resolve(repository, path), `${path} ${Math.random()}\n`);
		git(repository, "add", path);
		git(repository, "commit", "-m", `Change ${path}`);
		return git(repository, "rev-parse", "HEAD");
	}

	async function createRepository(): Promise<string> {
		const path = await mkdtemp(resolve(tmpdir(), "vercel-ignore-build-"));
		repositories.push(path);
		git(path, "init", "--quiet", "--initial-branch=feature");
		git(path, "config", "user.email", "test@example.com");
		git(path, "config", "user.name", "Test");
		git(path, "config", "commit.gpgsign", "false");
		return path;
	}

	/** Vercel's exit code convention: 0 skips the build, 1 builds it. */
	function run(cwd: string, environment: Record<string, string>): number | null {
		return spawnSync(process.execPath, [script], {
			cwd,
			env: { PATH: process.env.PATH, VERCEL_GIT_COMMIT_REF: "feature", ...environment },
			encoding: "utf8",
		}).status;
	}

	it("skips a commit that changes nothing the site reads since the last deployment", async () => {
		const path = await createRepository();
		const deployed = await commitFile(path, "apps/site/src/main.tsx");
		await commitFile(path, "packages/server/src/index.ts");
		await commitFile(path, "apps/mobile/app/index.tsx");
		expect(run(path, { VERCEL_ENV: "preview", VERCEL_GIT_PREVIOUS_SHA: deployed })).toBe(0);
	});

	it("builds a commit that changes the site since the last deployment", async () => {
		const path = await createRepository();
		const deployed = await commitFile(path, "packages/server/src/index.ts");
		await commitFile(path, "apps/site/src/main.tsx");
		await commitFile(path, "packages/server/src/cli.ts");
		expect(run(path, { VERCEL_ENV: "preview", VERCEL_GIT_PREVIOUS_SHA: deployed })).toBe(1);
	});

	it("builds when the last deployment is missing, unknown or the same commit", async () => {
		const path = await createRepository();
		await commitFile(path, "packages/server/src/index.ts");
		const head = await commitFile(path, "packages/server/src/cli.ts");
		// A branch's first deployment has no previous SHA.
		expect(run(path, { VERCEL_ENV: "preview" })).toBe(1);
		// A commit a force push removed, or one older than the shallow clone.
		expect(run(path, { VERCEL_ENV: "preview", VERCEL_GIT_PREVIOUS_SHA: "f".repeat(40) })).toBe(1);
		// A redeploy of the same commit.
		expect(run(path, { VERCEL_ENV: "preview", VERCEL_GIT_PREVIOUS_SHA: head })).toBe(1);
	});

	it("builds every production commit on main", async () => {
		const path = await createRepository();
		const deployed = await commitFile(path, "apps/site/src/main.tsx");
		await commitFile(path, "packages/server/src/index.ts");
		await commitFile(path, "CHANGELOG.md");
		expect(
			run(path, {
				VERCEL_ENV: "production",
				VERCEL_GIT_COMMIT_REF: "main",
				VERCEL_GIT_PREVIOUS_SHA: deployed,
			}),
		).toBe(1);
	});
});
