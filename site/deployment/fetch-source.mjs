import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

const commitSha = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(commitSha ?? "")) {
	throw new Error("VERCEL_GIT_COMMIT_SHA must be the full 40-character Git commit SHA");
}

const response = await fetch(`https://codeload.github.com/karimsa/mdxserve/tar.gz/${commitSha}`, {
	signal: AbortSignal.timeout(60_000),
});
if (!response.ok) throw new Error(`Unable to fetch source commit ${commitSha}: HTTP ${response.status}`);

const archivePath = "/tmp/mdxserve-source.tar.gz";
await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
execFileSync("tar", ["-xzf", archivePath, "--strip-components=1", "-C", "/opt/mdxserve"]);
