import { pathToFileURL } from "node:url";
import { productionDomain } from "./check-promotion-freshness.mjs";

const apiOrigin = "https://api.vercel.com";
const pollIntervalMs = 5_000;
const waitLimitMs = 3 * 60 * 1000;

export async function promoteProductionDeployment({
	token,
	teamId,
	projectId,
	deploymentId,
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
		!/^dpl_[A-Za-z0-9]+$/.test(deploymentId)
	) {
		throw new Error("Vercel token, team ID, project ID, and deployment ID are required");
	}

	const promoteUrl = new URL(`/v10/projects/${projectId}/promote/${deploymentId}`, apiOrigin);
	promoteUrl.searchParams.set("teamId", teamId);
	const authorization = { Authorization: `Bearer ${token}` };
	const promotion = await fetchImpl(promoteUrl, {
		method: "POST",
		headers: { ...authorization, "Content-Type": "application/json" },
		body: "{}",
		signal: AbortSignal.timeout(10_000),
	});
	if (!promotion.ok) {
		throw new Error(`Vercel promotion returned HTTP ${promotion.status}`);
	}

	const aliasUrl = new URL(`/v4/aliases/${productionDomain}`, apiOrigin);
	aliasUrl.searchParams.set("teamId", teamId);
	aliasUrl.searchParams.set("projectId", projectId);
	const deadline = now() + timeoutMs;
	while (now() < deadline) {
		let aliasResponse;
		try {
			aliasResponse = await fetchImpl(aliasUrl, {
				headers: authorization,
				signal: AbortSignal.timeout(10_000),
			});
		} catch {
			// The promotion may have succeeded even if an alias lookup briefly fails.
		}
		if (aliasResponse?.ok) {
			const alias = await aliasResponse.json();
			if (alias?.projectId !== projectId || alias.alias !== productionDomain) {
				throw new Error("Vercel production alias has unexpected project metadata");
			}
			if (alias.deploymentId === deploymentId) return;
		} else if (aliasResponse && aliasResponse.status !== 429 && aliasResponse.status < 500) {
			throw new Error(`Vercel production alias lookup returned HTTP ${aliasResponse.status}`);
		}
		const remaining = deadline - now();
		if (remaining > 0) await sleep(Math.min(pollMs, remaining));
	}
	throw new Error(`Timed out waiting for ${productionDomain} to serve ${deploymentId}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await promoteProductionDeployment({
		token: process.env.VERCEL_TOKEN,
		teamId: process.env.VERCEL_ORG_ID,
		projectId: process.env.VERCEL_PROJECT_ID,
		deploymentId: process.argv[2],
	});
	process.stdout.write(`Promoted ${process.argv[2]} to ${productionDomain}\n`);
}
