import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const temporaryRepositories: string[] = [];

function git(repositoryPath: string, ...argumentsList: string[]): string {
	return execFileSync("git", argumentsList, {
		cwd: repositoryPath,
		encoding: "utf8",
	}).trim();
}

function commit(repositoryPath: string, subject: string, body?: string): void {
	git(repositoryPath, "commit", "--allow-empty", "-m", subject, ...(body ? ["-m", body] : []));
}

function runGenerator(repositoryPath: string, targetVersion?: string): void {
	execFileSync(
		resolve(projectRoot, "node_modules/.bin/tsx"),
		[resolve(projectRoot, "scripts/changelog.ts"), ...(targetVersion ? [targetVersion] : [])],
		{ cwd: repositoryPath, stdio: ["ignore", "pipe", "pipe"] },
	);
}

async function generate(repositoryPath: string, targetVersion?: string): Promise<string> {
	runGenerator(repositoryPath, targetVersion);
	return readFile(resolve(repositoryPath, "CHANGELOG.md"), "utf8");
}

afterEach(async () => {
	await Promise.all(
		temporaryRepositories
			.splice(0)
			.map((repositoryPath) => rm(repositoryPath, { recursive: true, force: true })),
	);
});

it("regenerates only tagged releases from original subjects", async () => {
	const repositoryPath = await mkdtemp(resolve(tmpdir(), "mdxserve-changelog-"));
	temporaryRepositories.push(repositoryPath);
	git(repositoryPath, "init", "-q");
	git(repositoryPath, "config", "user.name", "Changelog Test");
	git(repositoryPath, "config", "user.email", "changelog@example.com");
	await writeFile(resolve(repositoryPath, "package.json"), JSON.stringify({ version: "0.5.0" }));
	commit(repositoryPath, "Initial history");
	commit(repositoryPath, "Add a first feature (#35)", "Body text must not become a bullet");
	commit(repositoryPath, "Add CODEOWNERS for maintainers (#36)");
	git(repositoryPath, "tag", "v0.1.0");
	commit(repositoryPath, "0.2.0");
	git(repositoryPath, "tag", "v0.2.0");
	commit(repositoryPath, "Add background checks");
	git(repositoryPath, "tag", "v0.3.0");
	commit(repositoryPath, "feat(editor): add a panel (#41)", "More body text");
	commit(repositoryPath, "fix: avoid a crash (#42)");
	commit(repositoryPath, "build: change bundler (#43)");
	commit(repositoryPath, "Release v0.4.0");
	git(repositoryPath, "tag", "v0.4.0");
	commit(repositoryPath, "perf: unreleased speedup (#44)");

	const firstOutput = await generate(repositoryPath);
	expect(firstOutput).toMatch(/^v0\.4\.0\n\nWhat's new/m);
	expect(firstOutput).toContain("v0.3.0\n\nWhat's new");
	expect(firstOutput).toContain("v0.2.0\n\nWhat's new\n\nBug fixes");
	expect(firstOutput).toContain("v0.1.0\n\nWhat's new");
	expect(firstOutput).toContain("Add a first feature (#35)");
	expect(firstOutput).not.toContain("pull/35");
	expect(firstOutput).toContain(
		"feat(editor): add a panel ([#41](https://github.com/karimsa/mdxserve/pull/41))",
	);
	expect(firstOutput).toContain(
		"fix: avoid a crash ([#42](https://github.com/karimsa/mdxserve/pull/42))",
	);
	expect(firstOutput).not.toMatch(
		/0\.5\.0|unreleased speedup|Body text|More body text|build:|Release v|CODEOWNERS/,
	);
	expect(await generate(repositoryPath)).toBe(firstOutput);
	expect(() => runGenerator(repositoryPath, "0.5.0")).toThrow();
	expect(() => runGenerator(repositoryPath, "not-a-version")).toThrow();
	expect(await generate(repositoryPath, "0.3.0")).not.toContain("v0.4.0");
	expect(await generate(repositoryPath)).toBe(firstOutput);
});
