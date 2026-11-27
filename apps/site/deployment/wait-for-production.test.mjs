import assert from "node:assert/strict";
import test from "node:test";
import { waitForProductionDeployment } from "./wait-for-production.mjs";

const commitSha = "a".repeat(40);
const otherSha = "b".repeat(40);
const options = { token: "token", teamId: "team_123", projectId: "prj_123", commitSha };

function deployment(overrides = {}) {
	return {
		uid: "dpl_Matching123",
		projectId: options.projectId,
		target: "production",
		meta: { githubCommitSha: commitSha, githubCommitRef: "main" },
		readyState: "READY",
		...overrides,
	};
}

function page(deployments, next = null, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => ({ deployments, pagination: { next } }),
	};
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
			return responses.shift() ?? page([]);
		},
	};
}

test("waits for the exact production deployment and checks API results independently", async () => {
	const responses = [
		page([
			deployment({
				uid: "dpl_WrongCommit",
				meta: { githubCommitSha: otherSha, githubCommitRef: "main" },
			}),
			deployment({ uid: "dpl_WrongProject", projectId: "prj_other" }),
			deployment({ uid: "dpl_Preview", target: "preview" }),
			deployment({
				uid: "dpl_WrongBranch",
				meta: { githubCommitSha: commitSha, githubCommitRef: "feature" },
			}),
		]),
		page([deployment({ readyState: "BUILDING" })]),
		page([deployment()]),
	];
	const fake = harness(responses);
	const result = await waitForProductionDeployment({ ...options, ...fake, pollMs: 10 });
	assert.equal(result, "dpl_Matching123");
	assert.equal(fake.requests.length, 3);
	for (const { url, request } of fake.requests) {
		assert.equal(url.pathname, "/v7/deployments");
		assert.equal(url.searchParams.get("sha"), commitSha);
		assert.equal(url.searchParams.get("projectId"), options.projectId);
		assert.equal(url.searchParams.get("teamId"), options.teamId);
		assert.equal(url.searchParams.get("target"), "production");
		assert.equal(url.searchParams.get("branch"), "main");
		assert.equal(request.headers.Authorization, "Bearer token");
	}
});

test("checks later pages before waiting for another poll", async () => {
	const fake = harness([
		page([deployment({ readyState: "BUILDING" })], 12345),
		page([deployment()]),
	]);
	const result = await waitForProductionDeployment({ ...options, ...fake });
	assert.equal(result, "dpl_Matching123");
	assert.equal(fake.requests[1].url.searchParams.get("until"), "12345");
});

test("fails for a terminal matching deployment", async () => {
	for (const state of ["ERROR", "CANCELED", "BLOCKED"]) {
		const fake = harness([page([deployment({ readyState: state })])]);
		await assert.rejects(waitForProductionDeployment({ ...options, ...fake }), new RegExp(state));
	}
});

test("ignores the optional legacy state when readyState reports readiness", async () => {
	const fake = harness([page([deployment({ state: "BUILDING" })])]);
	assert.equal(await waitForProductionDeployment({ ...options, ...fake }), "dpl_Matching123");
});

test("uses readyState for terminal failures even when legacy state is absent", async () => {
	const fake = harness([page([deployment({ readyState: "ERROR", state: undefined })])]);
	await assert.rejects(waitForProductionDeployment({ ...options, ...fake }), /ended in ERROR/);
});

test("times out without promoting an unrelated deployment", async () => {
	const fake = harness([
		page([deployment({ meta: { githubCommitSha: otherSha, githubCommitRef: "main" } })]),
	]);
	await assert.rejects(
		waitForProductionDeployment({ ...options, ...fake, timeoutMs: 20, pollMs: 10 }),
		/Timed out/,
	);
	assert.equal(fake.requests.length, 2);
});

test("retries transient HTTP responses but rejects authorization failures", async () => {
	const retry = harness([page([], null, 429), page([], null, 503), page([deployment()])]);
	assert.equal(
		await waitForProductionDeployment({ ...options, ...retry, pollMs: 10 }),
		"dpl_Matching123",
	);
	const networkError = harness([]);
	let failures = 0;
	networkError.fetchImpl = async () => {
		failures += 1;
		throw new Error("connection reset");
	};
	await assert.rejects(
		waitForProductionDeployment({ ...options, ...networkError, timeoutMs: 20, pollMs: 10 }),
		/Timed out/,
	);
	assert.equal(failures, 2);
	const denied = harness([page([], null, 403)]);
	await assert.rejects(waitForProductionDeployment({ ...options, ...denied }), /HTTP 403/);
	assert.equal(denied.requests.length, 1);
});
