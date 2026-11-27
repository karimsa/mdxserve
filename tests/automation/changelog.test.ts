import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

/** The release version lives in the published server package's manifest. */
async function writeVersion(repositoryPath: string, version: string): Promise<void> {
	await mkdir(resolve(repositoryPath, "packages/server"), { recursive: true });
	await writeFile(
		resolve(repositoryPath, "packages/server/package.json"),
		JSON.stringify({ version }),
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

it("regenerates tagged releases and the requested package version from original subjects", async () => {
	const repositoryPath = await mkdtemp(resolve(tmpdir(), "mdxserve-changelog-"));
	temporaryRepositories.push(repositoryPath);
	git(repositoryPath, "init", "-q");
	git(repositoryPath, "config", "user.name", "Changelog Test");
	git(repositoryPath, "config", "user.email", "changelog@example.com");
	await writeVersion(repositoryPath, "0.5.0");
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
	const draftOutput = await generate(repositoryPath, "0.5.0");
	expect(draftOutput).toMatch(/^v0\.5\.0\n\nWhat's new/m);
	expect(draftOutput).toContain(
		"perf: unreleased speedup ([#44](https://github.com/karimsa/mdxserve/pull/44))",
	);
	expect(draftOutput).toContain(firstOutput);
	expect(await generate(repositoryPath, "0.5.0")).toBe(draftOutput);
	expect(() => runGenerator(repositoryPath, "0.6.0")).toThrow();
	git(repositoryPath, "tag", "v0.5.0");
	expect(await generate(repositoryPath)).toBe(draftOutput);
	expect(() => runGenerator(repositoryPath, "not-a-version")).toThrow();
	expect(await generate(repositoryPath, "0.3.0")).not.toContain("v0.4.0");
	expect(await generate(repositoryPath)).toBe(draftOutput);
}, 30_000);

it("ignores release candidates: their tags and version commits fold into the next stable release", async () => {
	const repositoryPath = await mkdtemp(resolve(tmpdir(), "mdxserve-changelog-rc-"));
	temporaryRepositories.push(repositoryPath);
	git(repositoryPath, "init", "-q");
	git(repositoryPath, "config", "user.name", "Changelog Test");
	git(repositoryPath, "config", "user.email", "changelog@example.com");
	await writeVersion(repositoryPath, "0.6.0");
	commit(repositoryPath, "Initial history");
	commit(repositoryPath, "feat: an earlier feature (#50)");
	git(repositoryPath, "tag", "v0.5.0");
	commit(repositoryPath, "feat: before the candidate (#51)");
	commit(repositoryPath, "0.6.0-rc.1 (#52)");
	git(repositoryPath, "tag", "v0.6.0-rc.1");
	commit(repositoryPath, "fix: found in the candidate (#53)");
	commit(repositoryPath, "0.6.0-rc.2 (#54)");
	git(repositoryPath, "tag", "v0.6.0-rc.2");

	// With only candidates tagged since 0.5.0, the latest release is still 0.5.0.
	const tagged = await generate(repositoryPath);
	expect(tagged).toMatch(/^v0\.5\.0\n/);
	expect(tagged).not.toMatch(/rc|before the candidate|found in the candidate/);

	expect(() => runGenerator(repositoryPath, "0.6.0-rc.1")).toThrow();

	const stable = await generate(repositoryPath, "0.6.0");
	expect(stable).toMatch(/^v0\.6\.0\n\nWhat's new/);
	expect(stable).toContain("feat: before the candidate ([#51]");
	expect(stable).toContain("fix: found in the candidate ([#53]");
	expect(stable).not.toMatch(/rc\.|#52|#54/);
	expect(stable).toContain(tagged.trim());
}, 30_000);
