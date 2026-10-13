import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runGitCliff } from "git-cliff";

const repositoryPath = process.cwd();
const packageJson = JSON.parse(await readFile(resolve(repositoryPath, "package.json"), "utf8")) as {
	version: string;
};
// v0.4.0 predates the changelog. Every later release is rebuilt from Git.
const changelogBaseline = "v0.4.0";
const targetVersion = process.argv[2] ?? packageJson.version;
if (process.argv.length > 3 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(targetVersion)) {
	throw new Error("Pass a target version such as 0.5.0.");
}

const targetParts = targetVersion.split(".").map(Number);
const baselineParts = changelogBaseline.slice(1).split(".").map(Number);
const targetIsAfterBaseline = targetParts.some((targetPart, index) => {
	const earlierPartsMatch = targetParts
		.slice(0, index)
		.every((part, partIndex) => part === baselineParts[partIndex]);
	return earlierPartsMatch && targetPart > baselineParts[index];
});
if (!targetIsAfterBaseline) {
	throw new Error(`Target version must be later than ${changelogBaseline}.`);
}

const targetTag = `v${targetVersion}`;
const existingTag = execFileSync("git", ["tag", "--list", targetTag], {
	cwd: repositoryPath,
	encoding: "utf8",
}).trim();

const cliffArguments = [
	"--config",
	resolve(import.meta.dirname, "../cliff.toml"),
	"--repository",
	repositoryPath,
	"--output",
	resolve(repositoryPath, "CHANGELOG.md"),
	"--offline",
];

if (existingTag) {
	// Stop at the release tag when this script is rerun after publishing.
	cliffArguments.push(`${changelogBaseline}..${targetTag}`);
} else {
	// git-cliff labels the untagged HEAD commits without creating a Git tag.
	cliffArguments.push("--tag", targetTag, `${changelogBaseline}..HEAD`);
}

await runGitCliff(cliffArguments, { cwd: repositoryPath });
