import assert from "node:assert/strict";
import test from "node:test";
import { shouldPromote } from "./check-promotion-freshness.mjs";

const candidateSha = "c".repeat(40);
const currentSha = "a".repeat(40);
const options = {
	token: "token",
	teamId: "team_123",
	projectId: "prj_123",
	candidateSha,
};

function reply(body, status = 200) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function alias(overrides = {}) {
	return {
		alias: "mdxserve.karim.build",
		projectId: options.projectId,
		deploymentId: "dpl_Current123",
		...overrides,
	};
}

function deployment(overrides = {}) {
	return {
		id: "dpl_Current123",
		projectId: options.projectId,
		readyState: "READY",
		gitSource: { sha: currentSha },
		...overrides,
	};
}

function harness(responses) {
	const requests = [];
	const delays = [];
	return {
		requests,
		delays,
		sleep: async (milliseconds) => {
			delays.push(milliseconds);
		},
		fetchImpl: async (url, request) => {
			requests.push({ url: new URL(url), request });
			const response = responses.shift() ?? reply(null, 500);
			if (response instanceof Error) throw response;
			return response;
		},
	};
}

test("promotes only when the live production commit is an ancestor", async () => {
	const fake = harness([reply(alias()), reply(deployment())]);
	const compared = [];
	const result = await shouldPromote({
		...options,
		...fake,
		isAncestor: (ancestor, descendant) => {
			compared.push([ancestor, descendant]);
			return ancestor === currentSha && descendant === candidateSha;
		},
	});
	assert.equal(result, true);
	assert.deepEqual(compared, [[currentSha, candidateSha]]);
	assert.equal(fake.requests[0].url.pathname, "/v4/aliases/mdxserve.karim.build");
	assert.equal(fake.requests[0].url.searchParams.get("projectId"), options.projectId);
	assert.equal(fake.requests[1].url.pathname, "/v13/deployments/dpl_Current123");
	assert.equal(fake.requests[1].url.searchParams.get("withGitRepoInfo"), "true");
	for (const { url, request } of fake.requests) {
		assert.equal(url.searchParams.get("teamId"), options.teamId);
		assert.equal(request.headers.Authorization, "Bearer token");
	}
});

test("skips an already-current or older queued release", async () => {
	const same = harness([reply(alias()), reply(deployment({ gitSource: { sha: candidateSha } }))]);
	assert.equal(await shouldPromote({ ...options, ...same, isAncestor: () => true }), false);

	const newer = harness([reply(alias()), reply(deployment())]);
	const compared = [];
	assert.equal(
		await shouldPromote({
			...options,
			...newer,
			isAncestor: (ancestor, descendant) => {
				compared.push([ancestor, descendant]);
				return ancestor === candidateSha && descendant === currentSha;
			},
		}),
		false,
	);
	assert.deepEqual(compared, [
		[currentSha, candidateSha],
		[candidateSha, currentSha],
	]);
});

test("accepts the current commit from Vercel metadata when gitSource is omitted", async () => {
	const fake = harness([
		reply(alias()),
		reply(deployment({ gitSource: undefined, meta: { githubCommitSha: currentSha } })),
	]);
	assert.equal(await shouldPromote({ ...options, ...fake, isAncestor: () => true }), true);
});

test("fails closed when production is unrelated or has missing metadata", async () => {
	const unrelated = harness([reply(alias()), reply(deployment())]);
	await assert.rejects(
		shouldPromote({ ...options, ...unrelated, isAncestor: () => false }),
		/unrelated/,
	);
	const noAlias = harness([reply(null, 404)]);
	await assert.rejects(shouldPromote({ ...options, ...noAlias }), /no current Vercel deployment/);
	assert.equal(noAlias.requests.length, 1);
	assert.deepEqual(noAlias.delays, []);
	const wrongProject = harness([reply(alias({ projectId: "prj_other" }))]);
	await assert.rejects(
		shouldPromote({ ...options, ...wrongProject }),
		/invalid deployment metadata/,
	);
	const noCommit = harness([reply(alias()), reply(deployment({ gitSource: {} }))]);
	await assert.rejects(shouldPromote({ ...options, ...noCommit }), /no trustworthy commit SHA/);
	assert.equal(noCommit.requests.length, 2);
	assert.deepEqual(noCommit.delays, []);
	const conflictingCommit = harness([
		reply(alias()),
		reply(deployment({ meta: { githubCommitSha: candidateSha } })),
	]);
	await assert.rejects(
		shouldPromote({ ...options, ...conflictingCommit }),
		/no trustworthy commit SHA/,
	);
	const wrongDeploymentProject = harness([
		reply(alias()),
		reply(deployment({ projectId: "prj_other" })),
	]);
	await assert.rejects(
		shouldPromote({ ...options, ...wrongDeploymentProject }),
		/no trustworthy commit SHA/,
	);
});

test("rejects Vercel authorization failures", async () => {
	const denied = harness([reply(null, 403)]);
	await assert.rejects(shouldPromote({ ...options, ...denied }), /HTTP 403/);
	assert.equal(denied.requests.length, 1);
	assert.deepEqual(denied.delays, []);
});

test("recovers from rate limiting while looking up the production alias", async () => {
	const fake = harness([reply(null, 429), reply(alias()), reply(deployment())]);
	assert.equal(await shouldPromote({ ...options, ...fake, isAncestor: () => true }), true);
	assert.deepEqual(
		fake.requests.map(({ url }) => url.pathname),
		[
			"/v4/aliases/mdxserve.karim.build",
			"/v4/aliases/mdxserve.karim.build",
			"/v13/deployments/dpl_Current123",
		],
	);
	assert.deepEqual(fake.delays, [5000]);
});

test("recovers from server and network failures while looking up the live deployment", async () => {
	const fake = harness([
		reply(alias()),
		reply(null, 503),
		new TypeError("network disconnected"),
		reply(deployment()),
	]);
	assert.equal(await shouldPromote({ ...options, ...fake, isAncestor: () => true }), true);
	assert.deepEqual(
		fake.requests.map(({ url }) => url.pathname),
		[
			"/v4/aliases/mdxserve.karim.build",
			"/v13/deployments/dpl_Current123",
			"/v13/deployments/dpl_Current123",
			"/v13/deployments/dpl_Current123",
		],
	);
	assert.deepEqual(fake.delays, [5000, 10000]);
});

test("fails closed after bounded retries for either production lookup", async () => {
	const rateLimited = harness(Array.from({ length: 4 }, () => reply(null, 429)));
	await assert.rejects(shouldPromote({ ...options, ...rateLimited }), /HTTP 429 after retries/);
	assert.equal(rateLimited.requests.length, 4);
	assert.deepEqual(rateLimited.delays, [5000, 10000, 20000]);

	const unavailable = harness([
		reply(alias()),
		...Array.from({ length: 4 }, () => reply(null, 503)),
	]);
	await assert.rejects(shouldPromote({ ...options, ...unavailable }), /HTTP 503 after retries/);
	assert.equal(unavailable.requests.length, 5);
	assert.deepEqual(unavailable.delays, [5000, 10000, 20000]);

	const disconnected = harness(Array.from({ length: 4 }, () => new TypeError("offline")));
	await assert.rejects(
		shouldPromote({ ...options, ...disconnected }),
		/Vercel production lookup failed after retries/,
	);
	assert.equal(disconnected.requests.length, 4);
});
