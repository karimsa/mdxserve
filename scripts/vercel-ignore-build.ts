// Vercel's Ignored Build Step for the site (`ignoreCommand` in vercel.json). Vercel runs it in
// its shallow clone before installing anything, so it uses Node's own type stripping and
// imports only Node built-ins. Exit 0 tells Vercel to skip the build and cancel the
// deployment; exit 1 (or any crash) builds it. Every doubt resolves to building.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Whether a changed path is something the site's build reads. The site imports nothing from
 * the other workspaces (apps/site/DEPLOYMENT.md), but `yarn install --immutable` at the
 * repository root reads the root manifest (its `packageManager` and `engines`), the lockfile,
 * the Yarn settings and every workspace's manifest before the site builds.
 */
export function isSiteBuildInput(path: string): boolean {
	return (
		path.startsWith("apps/site/") ||
		path.startsWith(".yarn/") ||
		["vercel.json", ".vercelignore", "package.json", "yarn.lock", ".yarnrc.yml"].includes(path) ||
		/^(apps|packages)\/[^/]+\/package\.json$/.test(path)
	);
}

interface BuildInputs {
	/** The branch Vercel is deploying (`VERCEL_GIT_COMMIT_REF`). */
	branch: string | undefined;
	/** `VERCEL_ENV`: `production` for the production branch. */
	environment: string | undefined;
	/** Paths changed since the branch's last successful deployment; undefined when unknown. */
	changedPaths: readonly string[] | undefined;
}

/** Decide whether Vercel should build this commit, and say why. */
export function decideBuild({ branch, environment, changedPaths }: BuildInputs): {
	build: boolean;
	reason: string;
} {
	// The release workflow promotes the production deployment of the tagged commit on main,
	// and a release commit changes only the server's version and the changelog.
	if (environment === "production" || branch === "main") {
		return { build: true, reason: "production branch: every main commit builds" };
	}
	if (changedPaths === undefined) {
		return { build: true, reason: "no comparison base: building" };
	}
	const input = changedPaths.find(isSiteBuildInput);
	return input === undefined
		? { build: false, reason: "no site build input changed: skipping" }
		: { build: true, reason: `${input} changed: building` };
}

/**
 * The paths that differ between the branch's last successful deployment and HEAD, or
 * undefined when that commit is unknown: a branch's first deployment, a commit outside the
 * shallow clone, or one a force push removed.
 */
function changedSinceLastDeployment(previousSha: string | undefined): string[] | undefined {
	if (!previousSha) return undefined;
	const diff = spawnSync("git", ["diff", "--name-only", "-z", previousSha, "HEAD", "--"], {
		encoding: "utf8",
	});
	if (diff.status !== 0) return undefined;
	const paths = diff.stdout.split("\0").filter(Boolean);
	// An empty diff is the same tree deployed again, as a redeploy does: build it.
	return paths.length === 0 ? undefined : paths;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const { build, reason } = decideBuild({
		branch: process.env.VERCEL_GIT_COMMIT_REF,
		environment: process.env.VERCEL_ENV,
		changedPaths: changedSinceLastDeployment(process.env.VERCEL_GIT_PREVIOUS_SHA),
	});
	process.stdout.write(`${reason}\n`);
	process.exit(build ? 1 : 0);
}
