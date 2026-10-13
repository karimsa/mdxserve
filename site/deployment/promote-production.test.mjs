import assert from "node:assert/strict";
import test from "node:test";
import { promoteProductionDeployment } from "./promote-production.mjs";

const options = {
	token: "project-token",
	teamId: "team_123",
	projectId: "prj_123",
	deploymentId: "dpl_Release123",
};

function reply(body, status = 200) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function alias(deploymentId = options.deploymentId) {
	return {
		alias: "mdxserve.karim.build",
		projectId: options.projectId,
		deploymentId,
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
			const response = responses.shift() ?? reply(alias("dpl_Previous123"));
			if (response instanceof Error) throw response;
			return response;
		},
	};
}

test("promotes with the project token and waits until the production domain moves", async () => {
	const fake = harness([reply({}, 202), reply(alias("dpl_Previous123")), reply(alias())]);
	await promoteProductionDeployment({ ...options, ...fake, pollMs: 10 });
	assert.equal(fake.requests.length, 3);
	const [promotion, firstLookup, secondLookup] = fake.requests;
	assert.equal(
		promotion.url.pathname,
		`/v10/projects/${options.projectId}/promote/${options.deploymentId}`,
	);
	assert.equal(promotion.url.searchParams.get("teamId"), options.teamId);
	assert.equal(promotion.request.method, "POST");
	assert.equal(promotion.request.headers.Authorization, "Bearer project-token");
	assert.equal(promotion.request.headers["Content-Type"], "application/json");
	assert.equal(promotion.request.body, "{}");
	for (const lookup of [firstLookup, secondLookup]) {
		assert.equal(lookup.url.pathname, "/v4/aliases/mdxserve.karim.build");
		assert.equal(lookup.url.searchParams.get("teamId"), options.teamId);
		assert.equal(lookup.url.searchParams.get("projectId"), options.projectId);
		assert.equal(lookup.request.headers.Authorization, "Bearer project-token");
	}
});

test("fails before alias polling when promotion is denied", async () => {
	const fake = harness([reply(null, 403)]);
	await assert.rejects(
		promoteProductionDeployment({ ...options, ...fake }),
		/promotion returned HTTP 403/,
	);
	assert.equal(fake.requests.length, 1);
});

test("fails closed on a mismatched production alias", async () => {
	const fake = harness([reply({}, 201), reply({ ...alias(), projectId: "prj_Other" })]);
	await assert.rejects(
		promoteProductionDeployment({ ...options, ...fake }),
		/unexpected project metadata/,
	);
	assert.equal(fake.requests.length, 2);
});

test("bounds alias polling and never retries the promotion request", async () => {
	const fake = harness([reply({}, 202), new TypeError("temporary network failure")]);
	await assert.rejects(
		promoteProductionDeployment({ ...options, ...fake, timeoutMs: 20, pollMs: 10 }),
		/Timed out/,
	);
	assert.equal(fake.requests.length, 3);
	assert.equal(fake.requests.filter(({ request }) => request.method === "POST").length, 1);
});
