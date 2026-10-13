import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runGitCliff } from "git-cliff";

const repositoryPath = process.cwd();
const earliestRelease = "v0.1.0";
const firstReleaseWithCurrentPullRequests = "v0.3.0";

function compareTags(firstTag: string, secondTag: string): number {
	const firstParts = firstTag.slice(1).split(".").map(Number);
	const secondParts = secondTag.slice(1).split(".").map(Number);
	for (let index = 0; index < firstParts.length; index += 1) {
		const difference = firstParts[index] - secondParts[index];
		if (difference !== 0) return difference;
	}
	return 0;
}

const releaseTags = execFileSync("git", ["tag", "--merged", "HEAD", "--list", "v*"], {
	cwd: repositoryPath,
	encoding: "utf8",
})
	.split("\n")
	.filter((tag) => /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
	.filter((tag) => compareTags(tag, earliestRelease) >= 0)
	.sort(compareTags);

const requestedVersion = process.argv[2];
if (
	process.argv.length > 3 ||
	(requestedVersion && !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(requestedVersion))
) {
	throw new Error("Pass a tagged release version such as 0.4.0.");
}

const targetTag = requestedVersion ? `v${requestedVersion}` : releaseTags.at(-1);
if (!targetTag || !releaseTags.includes(targetTag)) {
	throw new Error(`Release ${targetTag ?? "tag"} does not exist on this branch.`);
}
const rootCommit = execFileSync("git", ["rev-list", "--max-parents=0", targetTag], {
	cwd: repositoryPath,
	encoding: "utf8",
})
	.trim()
	.split("\n", 1)[0];

const changelogResult = await runGitCliff(
	[
		"--config",
		resolve(import.meta.dirname, "../cliff.toml"),
		"--repository",
		repositoryPath,
		"--offline",
		`${rootCommit}..${targetTag}`,
	],
	{ cwd: repositoryPath, stdio: "pipe" },
);

if (typeof changelogResult.stdout !== "string") {
	throw new Error("git-cliff did not return changelog text.");
}
const generatedSections = changelogResult.stdout
	.trim()
	.split(/(?=^v\d+\.\d+\.\d+\s*$)/m)
	.map((section) => section.trim())
	.filter(Boolean);
const notesByTag = new Map(
	generatedSections.map((section) => [section.split("\n", 1)[0], section]),
);
const output = releaseTags
	.filter((tag) => compareTags(tag, targetTag) <= 0)
	.reverse()
	.map((tag) => {
		const section = notesByTag.get(tag) ?? `${tag}\n\nWhat's new\n\nBug fixes`;
		return compareTags(tag, firstReleaseWithCurrentPullRequests) >= 0
			? section.replaceAll(/\(#([0-9]+)\)/g, "([#$1](https://github.com/karimsa/mdxserve/pull/$1))")
			: section;
	})
	.join("\n\n");

await writeFile(resolve(repositoryPath, "CHANGELOG.md"), `${output}\n`);
