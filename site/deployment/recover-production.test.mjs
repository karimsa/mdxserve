import assert from "node:assert/strict";
import test from "node:test";
import { recoverProductionDeployment } from "./recover-production.mjs";

const commitSha = "a".repeat(40);
const options = {
	token: "project-token",
	teamId: "team_123",
	projectId: "prj_123",
	deploymentId: "dpl_Original123",
	commitSha,
};

function deployment(id = options.deploymentId, overrides = {}) {
	return {
		id,
		name: "site",
		projectId: options.projectId,
		target: "production",
		readyState: "READY",
		gitSource: { sha: commitSha, ref: "main" },
		meta: { githubCommitSha: commitSha, githubCommitRef: "main" },
		...overrides,
	};
}

function reply(body, status = 200) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function project(overrides = {}) {
	return { id: options.projectId, autoAssignCustomDomains: false, ...overrides };
}

function harness(responses) {
	const requests = [];
	let time = 0;
	return {
		requests,
		now: () => time,
		sleep: async (milliseconds) => {
			time += milliseconds;
		},
		fetchImpl: async (url, request) => {
			requests.push({ url: new URL(url), request });
			return responses.shift() ?? reply(deployment("dpl_Recovered123", { readyState: "BUILDING" }));
		},
	};
}

test("rebuilds the exact tagged deployment and waits for verified READY", async () => {
	const fake = harness([
		reply(deployment()),
		reply(project()),
		reply({ id: "dpl_Recovered123", readyState: "QUEUED", aliasAssigned: false }),
		reply(deployment("dpl_Recovered123", { readyState: "BUILDING" })),
		reply(deployment("dpl_Recovered123")),
	]);
	const result = await recoverProductionDeployment({ ...options, ...fake, pollMs: 10 });
	assert.equal(result, "dpl_Recovered123");
	assert.equal(fake.requests.length, 5);
	assert.equal(fake.requests[0].url.pathname, "/v13/deployments/dpl_Original123");
	assert.equal(fake.requests[0].url.searchParams.get("withGitRepoInfo"), "true");
	assert.equal(fake.requests[1].url.pathname, "/v9/projects/prj_123");
	const creation = fake.requests[2];
	assert.equal(creation.url.pathname, "/v13/deployments");
	assert.equal(creation.url.searchParams.get("forceNew"), "1");
	assert.equal(creation.url.searchParams.get("teamId"), options.teamId);
	assert.equal(creation.request.method, "POST");
	assert.equal(creation.request.headers.Authorization, "Bearer project-token");
	assert.deepEqual(JSON.parse(creation.request.body), {
		name: "site",
		project: options.projectId,
		deploymentId: options.deploymentId,
		target: "production",
		withLatestCommit: false,
	});
	for (const lookup of [fake.requests[3], fake.requests[4]]) {
		assert.equal(lookup.url.pathname, "/v13/deployments/dpl_Recovered123");
		assert.equal(lookup.url.searchParams.get("withGitRepoInfo"), "true");
	}
});

test("rejects an original deployment with wrong commit, branch, or project before rebuilding", async () => {
	const invalid = [
		{ meta: { githubCommitSha: "b".repeat(40), githubCommitRef: "main" }, gitSource: null },
		{ meta: { githubCommitSha: commitSha, githubCommitRef: "feature" }, gitSource: null },
		{ projectId: "prj_other" },
		{ gitSource: { sha: "b".repeat(40), ref: "main" } },
		{ gitSource: { sha: commitSha, ref: "feature" } },
	];
	for (const overrides of invalid) {
		const fake = harness([reply(deployment(options.deploymentId, overrides))]);
		await assert.rejects(recoverProductionDeployment({ ...options, ...fake }), /does not match/);
		assert.equal(fake.requests.length, 1);
	}
});

test("rejects a recovered deployment with wrong commit, branch, or project", async () => {
	const invalid = [
		{ meta: { githubCommitSha: "b".repeat(40), githubCommitRef: "main" }, gitSource: null },
		{ meta: { githubCommitSha: commitSha, githubCommitRef: "feature" }, gitSource: null },
		{ projectId: "prj_other" },
		{ gitSource: { sha: "b".repeat(40), ref: "main" } },
		{ gitSource: { sha: commitSha, ref: "feature" } },
	];
	for (const overrides of invalid) {
		const fake = harness([
			reply(deployment()),
			reply(project()),
			reply({ id: "dpl_Recovered123" }),
			reply(deployment("dpl_Recovered123", overrides)),
		]);
		await assert.rejects(recoverProductionDeployment({ ...options, ...fake }), /does not match/);
		assert.equal(fake.requests.length, 4);
	}
});

test("refuses to rebuild if custom production domains can be assigned automatically", async () => {
	for (const settings of [
		project({ autoAssignCustomDomains: true }),
		project({ id: "prj_other" }),
	]) {
		const fake = harness([reply(deployment()), reply(settings)]);
		await assert.rejects(recoverProductionDeployment({ ...options, ...fake }), /disable automatic/);
		assert.equal(fake.requests.length, 2);
	}
});

test("fails on a recovered build error or timeout", async () => {
	const failed = harness([
		reply(deployment()),
		reply(project()),
		reply({ id: "dpl_Recovered123" }),
		reply(deployment("dpl_Recovered123", { readyState: "ERROR" })),
	]);
	await assert.rejects(recoverProductionDeployment({ ...options, ...failed }), /ended in ERROR/);
	const waiting = harness([
		reply(deployment()),
		reply(project()),
		reply({ id: "dpl_Recovered123" }),
	]);
	await assert.rejects(
		recoverProductionDeployment({ ...options, ...waiting, timeoutMs: 20, pollMs: 10 }),
		/Timed out/,
	);
	assert.equal(waiting.requests.length, 5);
});

test("fails if Vercel redeployment does not provide a new deployment ID", async () => {
	const fake = harness([
		reply(deployment()),
		reply(project()),
		reply({ id: options.deploymentId }),
	]);
	await assert.rejects(
		recoverProductionDeployment({ ...options, ...fake }),
		/no new deployment ID/,
	);
	assert.equal(fake.requests.length, 3);
});

test("fails when Vercel rejects the rebuild request", async () => {
	const fake = harness([reply(deployment()), reply(project()), reply(null, 403)]);
	await assert.rejects(
		recoverProductionDeployment({ ...options, ...fake }),
		/redeployment returned HTTP 403/,
	);
	assert.equal(fake.requests.length, 3);
});

test("refuses a redeployment that automatically assigned a domain", async () => {
	const fake = harness([
		reply(deployment()),
		reply(project()),
		reply({ id: "dpl_Recovered123", aliasAssigned: true }),
	]);
	await assert.rejects(recoverProductionDeployment({ ...options, ...fake }), /assigned domains/);
	assert.equal(fake.requests.length, 3);
});

test("tolerates brief lookup failures after Vercel accepts the rebuild", async () => {
	const fake = harness([
		reply(deployment()),
		reply(project()),
		reply({ id: "dpl_Recovered123", aliasAssigned: false }),
		reply(null, 404),
		reply(null, 429),
		reply(deployment("dpl_Recovered123")),
	]);
	assert.equal(
		await recoverProductionDeployment({ ...options, ...fake, pollMs: 10 }),
		"dpl_Recovered123",
	);
});
