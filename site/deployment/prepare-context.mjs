import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const stagedRoot = path.join(repositoryRoot, "site", ".build-source");
const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
	cwd: repositoryRoot,
	encoding: "utf8",
}).trim();

rmSync(stagedRoot, { recursive: true, force: true });
mkdirSync(stagedRoot);
for (const name of ["package.json", "yarn.lock", ".yarnrc.yml", "scripts", "src", "client"]) {
	cpSync(path.join(repositoryRoot, name), path.join(stagedRoot, name), { recursive: true });
}
writeFileSync(path.join(stagedRoot, ".complete"), `${commitSha}\n`);
process.stdout.write(`Prepared site container source from ${commitSha}\n`);
