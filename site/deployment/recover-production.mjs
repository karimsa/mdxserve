import { pathToFileURL } from "node:url";

const apiOrigin = "https://api.vercel.com";
const commitPattern = /^[0-9a-f]{40}$/i;
const deploymentPattern = /^dpl_[A-Za-z0-9]+$/;
const waitLimitMs = 15 * 60 * 1000;
const pollIntervalMs = 10_000;
const terminalStates = new Set(["ERROR", "CANCELED", "BLOCKED"]);

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertDeployment(deployment, { deploymentId, projectId, commitSha, productionBranch }) {
	const gitSource = isRecord(deployment?.gitSource) ? deployment.gitSource : null;
	const metadata = isRecord(deployment?.meta) ? deployment.meta : null;
	const gitSha = gitSource?.sha;
	const metaSha = metadata?.githubCommitSha;
	const gitBranch = gitSource?.ref;
	const metaBranch = metadata?.githubCommitRef;
	if (
		!isRecord(deployment) ||
		deployment.id !== deploymentId ||
		deployment.projectId !== projectId ||
		deployment.target !== "production" ||
		(gitSha !== commitSha && metaSha !== commitSha) ||
		(gitBranch !== productionBranch && metaBranch !== productionBranch) ||
		(gitSha && metaSha && gitSha !== metaSha) ||
		(gitBranch && metaBranch && gitBranch !== metaBranch)
	) {
		throw new Error("Vercel deployment does not match the tagged production commit");
	}
}

/** Rebuild the exact tag after the release owns the site-production queue. */
export async function recoverProductionDeployment({
	token,
	teamId,
	projectId,
	deploymentId,
	commitSha,
	productionBranch = "main",
	fetchImpl = fetch,
	now = Date.now,
	sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
	timeoutMs = waitLimitMs,
	pollMs = pollIntervalMs,
}) {
	if (
		!token ||
		!/^team_[A-Za-z0-9]+$/.test(teamId) ||
		!/^prj_[A-Za-z0-9]+$/.test(projectId) ||
		!deploymentPattern.test(deploymentId) ||
		!commitPattern.test(commitSha)
	) {
		throw new Error("Vercel credentials, project, deployment, and full commit SHA are required");
	}
	const authorization = { Authorization: `Bearer ${token}` };
	const originalUrl = new URL(`/v13/deployments/${deploymentId}`, apiOrigin);
	originalUrl.searchParams.set("teamId", teamId);
	originalUrl.searchParams.set("withGitRepoInfo", "true");
	const originalResponse = await fetchImpl(originalUrl, {
		headers: authorization,
		signal: AbortSignal.timeout(10_000),
	});
	if (!originalResponse.ok) {
		throw new Error(`Original Vercel deployment lookup returned HTTP ${originalResponse.status}`);
	}
	const original = await originalResponse.json();
	assertDeployment(original, { deploymentId, projectId, commitSha, productionBranch });
	if (original.readyState !== "READY" || typeof original.name !== "string" || !original.name) {
		throw new Error("Original Vercel production deployment is not ready or has no project name");
	}
	const projectUrl = new URL(`/v9/projects/${projectId}`, apiOrigin);
	projectUrl.searchParams.set("teamId", teamId);
	const projectResponse = await fetchImpl(projectUrl, {
		headers: authorization,
		signal: AbortSignal.timeout(10_000),
	});
	if (!projectResponse.ok) {
		throw new Error(`Vercel project lookup returned HTTP ${projectResponse.status}`);
	}
	const project = await projectResponse.json();
	if (project?.id !== projectId || project.autoAssignCustomDomains !== false) {
		throw new Error("Vercel project must disable automatic custom production domain assignment");
	}

	const redeployUrl = new URL("/v13/deployments", apiOrigin);
	redeployUrl.searchParams.set("teamId", teamId);
	redeployUrl.searchParams.set("forceNew", "1");
	const redeployResponse = await fetchImpl(redeployUrl, {
		method: "POST",
		headers: { ...authorization, "Content-Type": "application/json" },
		body: JSON.stringify({
			name: original.name,
			project: projectId,
			deploymentId,
			target: "production",
			withLatestCommit: false,
		}),
		signal: AbortSignal.timeout(10_000),
	});
	if (!redeployResponse.ok) {
		throw new Error(`Vercel redeployment returned HTTP ${redeployResponse.status}`);
	}
	const created = await redeployResponse.json();
	if (created?.aliasAssigned === true) {
		throw new Error("Vercel unexpectedly assigned domains during redeployment");
	}
	const recoveredId = created?.id;
	if (!deploymentPattern.test(recoveredId) || recoveredId === deploymentId) {
		throw new Error("Vercel redeployment returned no new deployment ID");
	}

	const recoveredUrl = new URL(`/v13/deployments/${recoveredId}`, apiOrigin);
	recoveredUrl.searchParams.set("teamId", teamId);
	recoveredUrl.searchParams.set("withGitRepoInfo", "true");
	const deadline = now() + timeoutMs;
	while (now() < deadline) {
		let response;
		try {
			response = await fetchImpl(recoveredUrl, {
				headers: authorization,
				signal: AbortSignal.timeout(Math.min(10_000, deadline - now())),
			});
		} catch {
			// A new deployment may briefly be unavailable while Vercel starts the build.
		}
		if (
			response &&
			!response.ok &&
			![404, 429].includes(response.status) &&
			response.status < 500
		) {
			throw new Error(`Recovered Vercel deployment lookup returned HTTP ${response.status}`);
		}
		if (response?.ok) {
			const recovered = await response.json();
			assertDeployment(recovered, {
				deploymentId: recoveredId,
				projectId,
				commitSha,
				productionBranch,
			});
			if (recovered.readyState === "READY") return recoveredId;
			if (terminalStates.has(recovered.readyState)) {
				throw new Error(`Recovered Vercel deployment ended in ${recovered.readyState}`);
			}
		}
		const remaining = deadline - now();
		if (remaining > 0) await sleep(Math.min(pollMs, remaining));
	}
	throw new Error(`Timed out waiting for recovered Vercel deployment ${recoveredId}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const deploymentId = await recoverProductionDeployment({
		token: process.env.VERCEL_TOKEN,
		teamId: process.env.VERCEL_ORG_ID,
		projectId: process.env.VERCEL_PROJECT_ID,
		deploymentId: process.argv[2],
		commitSha: process.argv[3],
	});
	process.stdout.write(`${deploymentId}\n`);
}
