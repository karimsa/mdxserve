import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { productionDomain } from "./check-promotion-freshness.mjs";

const apiOrigin = "https://api.vercel.com";
const imageIdPattern = /^image_[A-Za-z0-9]+$/;
const repositoryIdPattern = /^repo_[A-Za-z0-9]+$/;
const deploymentIdPattern = /^dpl_[A-Za-z0-9]+$/;
const commitPattern = /^[0-9a-f]{40}$/i;
const imageTagPattern = /^[0-9a-f]{12}$/i;
const maxPageSize = 100;
const maxDeletes = 100;

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runVercel(args) {
	const result = spawnSync("npx", ["--yes", "vercel@63.1.0", "vcr", "image", ...args], {
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
	});
	if (result.error || result.status !== 0) {
		throw new Error(`Vercel image command failed (exit ${result.status ?? "unknown"})`);
	}
	return result.stdout;
}

async function getProductionSha({ fetchImpl, token, teamId, projectId }) {
	async function getJson(pathname, query = {}) {
		const url = new URL(pathname, apiOrigin);
		url.searchParams.set("teamId", teamId);
		for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
		const response = await fetchImpl(url, {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) throw new Error(`Vercel production lookup returned HTTP ${response.status}`);
		return response.json();
	}

	const alias = await getJson(`/v4/aliases/${productionDomain}`, { projectId });
	if (
		!isRecord(alias) ||
		alias.alias !== productionDomain ||
		alias.projectId !== projectId ||
		!deploymentIdPattern.test(alias.deploymentId)
	) {
		throw new Error("Vercel production alias has invalid project or deployment metadata");
	}
	const deployment = await getJson(`/v13/deployments/${alias.deploymentId}`, {
		withGitRepoInfo: "true",
	});
	const gitSha = isRecord(deployment?.gitSource) ? deployment.gitSource.sha : undefined;
	const metaSha = isRecord(deployment?.meta) ? deployment.meta.githubCommitSha : undefined;
	const sha = gitSha ?? metaSha;
	if (
		!isRecord(deployment) ||
		deployment.id !== alias.deploymentId ||
		deployment.projectId !== projectId ||
		deployment.readyState !== "READY" ||
		!commitPattern.test(sha) ||
		(gitSha && metaSha && gitSha.toLowerCase() !== metaSha.toLowerCase())
	) {
		throw new Error("Current Vercel production deployment has no trustworthy commit SHA");
	}
	return sha.toLowerCase();
}

async function listImages({ runCli, token, teamId, projectId }) {
	const images = [];
	let cursor;
	const seenCursors = new Set();
	for (;;) {
		const args = [
			"ls",
			"site",
			"--project",
			projectId,
			"--scope",
			teamId,
			"--limit",
			String(maxPageSize),
			"--json",
			"--token",
			token,
		];
		if (cursor) args.push("--next", cursor);
		let page;
		try {
			page = JSON.parse(await runCli(args));
		} catch (error) {
			throw new Error("Vercel image inventory is not valid JSON", { cause: error });
		}
		if (!isRecord(page) || !Array.isArray(page.images)) {
			throw new Error("Vercel image inventory has an unexpected shape");
		}
		images.push(...page.images);
		const nextCursor = page.nextCursor;
		if (nextCursor === undefined || nextCursor === null) {
			if (page.images.length >= maxPageSize) {
				throw new Error("Vercel image inventory may be truncated");
			}
			return images;
		}
		if (typeof nextCursor !== "string" || !nextCursor || seenCursors.has(nextCursor)) {
			throw new Error("Vercel image inventory has an invalid cursor");
		}
		seenCursors.add(nextCursor);
		cursor = nextCursor;
	}
}

/** Pick deletions only after the full inventory and production image agree. */
export function planImageRetention(images, productionSha) {
	if (!Array.isArray(images) || !commitPattern.test(productionSha)) {
		throw new Error("A complete image inventory and production commit SHA are required");
	}
	const imageIds = new Set();
	const tags = new Set();
	let repositoryId;
	for (const image of images) {
		if (
			!isRecord(image) ||
			!imageIdPattern.test(image.id) ||
			!repositoryIdPattern.test(image.repositoryId) ||
			image.kind !== "manifest" ||
			image.status !== "ready" ||
			!Array.isArray(image.tags) ||
			image.tags.length > 1 ||
			(image.tags.length === 1 && !imageTagPattern.test(image.tags[0])) ||
			typeof image.createdAt !== "string" ||
			!Number.isFinite(Date.parse(image.createdAt)) ||
			new Date(image.createdAt).toISOString() !== image.createdAt ||
			imageIds.has(image.id) ||
			(repositoryId && repositoryId !== image.repositoryId)
		) {
			throw new Error("Vercel image inventory contains unexpected image metadata");
		}
		repositoryId = image.repositoryId;
		imageIds.add(image.id);
		if (image.tags.length === 1) {
			const tag = image.tags[0].toLowerCase();
			if (tags.has(tag)) throw new Error("Vercel image inventory has duplicate tags");
			tags.add(tag);
		}
	}
	const productionTag = productionSha.slice(0, 12).toLowerCase();
	const production = images.find((image) => image.tags[0]?.toLowerCase() === productionTag);
	if (!production) throw new Error("Production image is missing from the Vercel registry");
	const others = images.filter((image) => image.id !== production.id);
	const tagged = others.filter((image) => image.tags.length === 1);
	tagged.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
	if (tagged.length > 1 && tagged[0].createdAt === tagged[1].createdAt) {
		throw new Error("Newest non-production image is ambiguous");
	}
	const newest = tagged[0];
	const deleteIds = others
		.filter((image) => image.id !== newest?.id)
		.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
		.map((image) => image.id);
	return {
		productionId: production.id,
		newestId: newest?.id,
		deleteIds,
	};
}

export async function retainImages({
	token,
	teamId,
	projectId,
	apply = false,
	fetchImpl = fetch,
	runCli = runVercel,
}) {
	if (!token || !/^team_[A-Za-z0-9]+$/.test(teamId) || !/^prj_[A-Za-z0-9]+$/.test(projectId)) {
		throw new Error("Vercel token, team ID, and project ID are required");
	}
	let deleted = 0;
	const deletedIds = new Set();
	for (;;) {
		const images = await listImages({ runCli, token, teamId, projectId });
		if (images.some((image) => deletedIds.has(image.id))) {
			throw new Error("Vercel image inventory still lists an image already deleted");
		}
		const productionSha = await getProductionSha({ fetchImpl, token, teamId, projectId });
		const plan = planImageRetention(images, productionSha);
		if (!apply) return { ...plan, deleted: 0 };
		if (plan.deleteIds.length === 0) return { ...plan, deleted };
		if (deleted >= maxDeletes) throw new Error("Image cleanup exceeded its delete limit");
		const imageId = plan.deleteIds[0];
		let removal;
		try {
			removal = JSON.parse(
				await runCli([
					"rm",
					"site",
					imageId,
					"--project",
					projectId,
					"--scope",
					teamId,
					"--yes",
					"--json",
					"--token",
					token,
				]),
			);
		} catch (error) {
			throw new Error("Vercel image deletion did not return valid JSON", { cause: error });
		}
		if (
			!isRecord(removal) ||
			removal.imageId !== imageId ||
			removal.repository !== "site" ||
			removal.deleted !== true
		) {
			throw new Error("Vercel did not confirm the requested image deletion");
		}
		deletedIds.add(imageId);
		deleted += 1;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const apply = process.argv.includes("--apply");
	if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--apply")) {
		throw new Error("Usage: node site/deployment/retain-images.mjs [--apply]");
	}
	const result = await retainImages({
		token: process.env.VERCEL_TOKEN,
		teamId: process.env.VERCEL_ORG_ID,
		projectId: process.env.VERCEL_PROJECT_ID,
		apply,
	});
	process.stdout.write(
		apply
			? `Deleted ${result.deleted} images; kept production ${result.productionId} and newest ${result.newestId ?? "none"}\n`
			: `Preview: keep production ${result.productionId} and newest ${result.newestId ?? "none"}; delete ${result.deleteIds.length} images\n`,
	);
}
