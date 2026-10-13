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
		{
			cwd: repositoryPath,
			stdio: ["ignore", "pipe", "pipe"],
		},
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

it("regenerates release notes from tagged history without commit bodies or maintenance changes", async () => {
	const repositoryPath = await mkdtemp(resolve(tmpdir(), "mdxserve-changelog-"));
	temporaryRepositories.push(repositoryPath);
	git(repositoryPath, "init", "-q");
	git(repositoryPath, "config", "user.name", "Changelog Test");
	git(repositoryPath, "config", "user.email", "changelog@example.com");
	await writeFile(resolve(repositoryPath, "package.json"), JSON.stringify({ version: "0.4.0" }));
	commit(repositoryPath, "Initial history");
	git(repositoryPath, "tag", "v0.4.0");
	expect(() => runGenerator(repositoryPath, "0.4.0")).toThrow();
	expect(() => runGenerator(repositoryPath, "bad-version")).toThrow();
	commit(
		repositoryPath,
		"feat(editor): add a panel (#41)",
		"Details that must not become a bullet",
	);
	commit(repositoryPath, "build: change bundler (#42)");
	git(repositoryPath, "tag", "v0.5.0");
	commit(repositoryPath, "perf: speed up rendering (#43)");
	commit(repositoryPath, "fix: avoid a crash (#44)", "Body with a fake feat: line");
	commit(repositoryPath, "revert: undo a regression (#45)");
	commit(repositoryPath, "Add a legacy feature (#46)");
	commit(repositoryPath, "Fix a legacy bug (#47)");
	commit(repositoryPath, "docs: revise examples (#48)");
	commit(repositoryPath, "Release v0.6.0");
	commit(repositoryPath, "Neutral legacy subject (#49)");

	const firstOutput = await generate(repositoryPath, "0.6.0");
	expect(firstOutput).toContain("v0.6.0\n\nWhat's new");
	expect(firstOutput).toContain("Bug fixes");
	expect(firstOutput).toContain("v0.5.0\n\nWhat's new");
	expect(firstOutput).toContain(
		"feat(editor): add a panel ([#41](https://github.com/karimsa/mdxserve/pull/41))",
	);
	expect(firstOutput).toContain(
		"perf: speed up rendering ([#43](https://github.com/karimsa/mdxserve/pull/43))",
	);
	expect(firstOutput).toContain(
		"fix: avoid a crash ([#44](https://github.com/karimsa/mdxserve/pull/44))",
	);
	expect(firstOutput).toContain(
		"revert: undo a regression ([#45](https://github.com/karimsa/mdxserve/pull/45))",
	);
	expect(firstOutput).toContain(
		"Add a legacy feature ([#46](https://github.com/karimsa/mdxserve/pull/46))",
	);
	expect(firstOutput).toContain(
		"Fix a legacy bug ([#47](https://github.com/karimsa/mdxserve/pull/47))",
	);
	expect(firstOutput).not.toMatch(
		/v0\.4\.0|Details that must|Body with a fake|build:|docs:|Release v|Neutral legacy/,
	);
	expect(await generate(repositoryPath, "0.6.0")).toBe(firstOutput);

	git(repositoryPath, "tag", "v0.6.0");
	commit(repositoryPath, "feat: unreleased work (#50)");
	await writeFile(resolve(repositoryPath, "package.json"), JSON.stringify({ version: "0.6.0" }));
	expect(await generate(repositoryPath)).toBe(firstOutput);
});
