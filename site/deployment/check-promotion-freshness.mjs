import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const apiOrigin = "https://api.vercel.com";
const productionDomain = "mdxserve.karim.build";
const commitPattern = /^[0-9a-f]{40}$/i;
const deploymentPattern = /^dpl_[A-Za-z0-9]+$/;
const lookupAttempts = 4;

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function getJson(fetchImpl, sleep, pathname, token, teamId, extraQuery = {}) {
	const url = new URL(pathname, apiOrigin);
	url.searchParams.set("teamId", teamId);
	for (const [name, value] of Object.entries(extraQuery)) url.searchParams.set(name, value);
	for (let attempt = 0; attempt < lookupAttempts; attempt += 1) {
		let response;
		try {
			response = await fetchImpl(url, {
				headers: { Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(10_000),
			});
		} catch (error) {
			if (attempt === lookupAttempts - 1) {
				throw new Error("Vercel production lookup failed after retries", { cause: error });
			}
		}
		if (response) {
			if (response.status === 404) return null;
			if (response.ok) return response.json();
			if (response.status !== 429 && response.status < 500) {
				throw new Error(`Vercel production lookup returned HTTP ${response.status}`);
			}
			if (attempt === lookupAttempts - 1) {
				throw new Error(`Vercel production lookup returned HTTP ${response.status} after retries`);
			}
		}
		await sleep(5_000 * 2 ** attempt);
	}
}

function gitIsAncestor(ancestor, descendant) {
	const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant]);
	if (result.status === 0) return true;
	if (result.status === 1) return false;
	throw new Error(`Could not compare release commits with git (exit ${result.status})`);
}

/** Return false when a queued older release would replace the live site. */
export async function shouldPromote({
	token,
	teamId,
	projectId,
	candidateSha,
	fetchImpl = fetch,
	isAncestor = gitIsAncestor,
	sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
	if (!token || !teamId || !projectId || !commitPattern.test(candidateSha)) {
		throw new Error("Vercel credentials, project ID, and a full candidate commit SHA are required");
	}
	const alias = await getJson(fetchImpl, sleep, `/v4/aliases/${productionDomain}`, token, teamId, {
		projectId,
	});
	if (alias === null) throw new Error("Production domain has no current Vercel deployment");
	if (
		!isRecord(alias) ||
		alias.alias !== productionDomain ||
		alias.projectId !== projectId ||
		!deploymentPattern.test(alias.deploymentId)
	) {
		throw new Error("Vercel production alias returned invalid deployment metadata");
	}
	const current = await getJson(
		fetchImpl,
		sleep,
		`/v13/deployments/${alias.deploymentId}`,
		token,
		teamId,
		{ withGitRepoInfo: "true" },
	);
	const gitSha = isRecord(current?.gitSource) ? current.gitSource.sha : undefined;
	const metaSha = isRecord(current?.meta) ? current.meta.githubCommitSha : undefined;
	const currentSha = gitSha ?? metaSha;
	if (
		!isRecord(current) ||
		current.id !== alias.deploymentId ||
		current.projectId !== projectId ||
		current.readyState !== "READY" ||
		!commitPattern.test(currentSha) ||
		(gitSha && metaSha && gitSha !== metaSha)
	) {
		throw new Error("Current Vercel production deployment has no trustworthy commit SHA");
	}
	if (currentSha === candidateSha) return false;
	if (isAncestor(currentSha, candidateSha)) return true;
	if (isAncestor(candidateSha, currentSha)) return false;
	throw new Error("Current production commit is unrelated to the tagged release");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const promote = await shouldPromote({
		token: process.env.VERCEL_TOKEN,
		teamId: process.env.VERCEL_ORG_ID,
		projectId: process.env.VERCEL_PROJECT_ID,
		candidateSha: process.argv[2],
	});
	process.stdout.write(`${promote}\n`);
}
