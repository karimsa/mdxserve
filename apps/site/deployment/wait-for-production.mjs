import { pathToFileURL } from "node:url";

const apiUrl = "https://api.vercel.com/v7/deployments";
const waitLimitMs = 15 * 60 * 1000;
const pollIntervalMs = 10 * 1000;
const requestTimeoutMs = 10 * 1000;
const maxPages = 20;
const terminalStates = new Set(["ERROR", "CANCELED", "BLOCKED"]);

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deploymentMatches(deployment, projectId, commitSha, productionBranch) {
	return (
		isRecord(deployment) &&
		deployment.projectId === projectId &&
		deployment.target === "production" &&
		isRecord(deployment.meta) &&
		deployment.meta.githubCommitSha === commitSha &&
		deployment.meta.githubCommitRef === productionBranch
	);
}

function validatedDeploymentId(deployment) {
	if (typeof deployment.uid !== "string" || !/^dpl_[A-Za-z0-9]+$/.test(deployment.uid)) {
		throw new Error("Matching Vercel deployment has no valid deployment ID");
	}
	return deployment.uid;
}

async function listMatchingDeployments({
	fetchImpl,
	token,
	teamId,
	projectId,
	commitSha,
	productionBranch,
	now,
	deadline,
}) {
	const deployments = [];
	const seenCursors = new Set();
	let cursor;
	for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
		if (now() >= deadline)
			throw new Error(`Timed out waiting for READY Vercel production deployment for ${commitSha}`);
		const url = new URL(apiUrl);
		url.searchParams.set("teamId", teamId);
		url.searchParams.set("projectId", projectId);
		url.searchParams.set("target", "production");
		url.searchParams.set("sha", commitSha);
		url.searchParams.set("branch", productionBranch);
		url.searchParams.set("limit", "100");
		if (cursor) url.searchParams.set("until", cursor);

		let response;
		try {
			response = await fetchImpl(url, {
				headers: { Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(Math.min(requestTimeoutMs, deadline - now())),
			});
		} catch (error) {
			throw new RetryableError(`Vercel deployment lookup failed: ${error.message}`, {
				cause: error,
			});
		}
		if (response.status === 429 || response.status >= 500) {
			throw new RetryableError(`Vercel deployment lookup returned HTTP ${response.status}`);
		}
		if (!response.ok) {
			throw new Error(`Vercel deployment lookup returned HTTP ${response.status}`);
		}
		const body = await response.json();
		if (!isRecord(body) || !Array.isArray(body.deployments) || !isRecord(body.pagination)) {
			throw new Error("Vercel deployment lookup returned an invalid response");
		}
		deployments.push(
			...body.deployments.filter((deployment) =>
				deploymentMatches(deployment, projectId, commitSha, productionBranch),
			),
		);
		const nextCursor = body.pagination.next;
		if (nextCursor === null || nextCursor === undefined) return deployments;
		if (typeof nextCursor !== "number" && typeof nextCursor !== "string") {
			throw new Error("Vercel deployment lookup returned an invalid page cursor");
		}
		cursor = String(nextCursor);
		if (seenCursors.has(cursor)) throw new Error("Vercel deployment lookup repeated a page cursor");
		seenCursors.add(cursor);
	}
	throw new Error("Vercel deployment lookup exceeded the page limit");
}

class RetryableError extends Error {}

export async function waitForProductionDeployment({
	token,
	teamId,
	projectId,
	commitSha,
	productionBranch = "main",
	fetchImpl = fetch,
	now = Date.now,
	sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
	timeoutMs = waitLimitMs,
	pollMs = pollIntervalMs,
}) {
	if (!token || !teamId || !projectId || !/^[0-9a-f]{40}$/i.test(commitSha)) {
		throw new Error("Vercel token, team ID, project ID, and a full commit SHA are required");
	}
	const deadline = now() + timeoutMs;
	while (now() < deadline) {
		let deployments;
		try {
			deployments = await listMatchingDeployments({
				fetchImpl,
				token,
				teamId,
				projectId,
				commitSha,
				productionBranch,
				now,
				deadline,
			});
		} catch (error) {
			if (!(error instanceof RetryableError)) throw error;
			process.stderr.write(`${error.message}; retrying\n`);
			deployments = [];
		}
		const ready = deployments.find((deployment) => deployment.readyState === "READY");
		if (ready) return validatedDeploymentId(ready);
		if (
			deployments.length > 0 &&
			deployments.every((deployment) => terminalStates.has(deployment.readyState))
		) {
			throw new Error(
				`Vercel production deployment for ${commitSha} ended in ${deployments[0].readyState}`,
			);
		}
		const remaining = deadline - now();
		if (remaining > 0) await sleep(Math.min(pollMs, remaining));
	}
	throw new Error(`Timed out waiting for READY Vercel production deployment for ${commitSha}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const deploymentId = await waitForProductionDeployment({
		token: process.env.VERCEL_TOKEN,
		teamId: process.env.VERCEL_ORG_ID,
		projectId: process.env.VERCEL_PROJECT_ID,
		commitSha: process.argv[2],
	});
	process.stdout.write(`${deploymentId}\n`);
}
