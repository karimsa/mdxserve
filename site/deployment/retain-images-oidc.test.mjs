import assert from "node:assert/strict";
import test from "node:test";
import { retainImagesWithOidc } from "./retain-images-oidc.mjs";

const env = {
	VERCEL_TOKEN: "metadata-token",
	VERCEL_ORG_ID: "team_123",
	VERCEL_PROJECT_ID: "prj_456",
	GH_TOKEN: "github-token",
	ACTIONS_ID_TOKEN_REQUEST_URL:
		"https://pipelines.actions.githubusercontent.com/job/oidc?existing=1",
	ACTIONS_ID_TOKEN_REQUEST_TOKEN: "actions-request-token",
};

function reply(body, status = 200) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function harness({
	exchangeStatus = 200,
	exchangeBody = { access_token: "vcr.access.token" },
	oidcBody = { value: "github.oidc.token" },
} = {}) {
	const calls = [];
	const masks = [];
	const fetchImpl = async (url, request) => {
		const parsed = new URL(url);
		calls.push({ url: parsed, request });
		if (parsed.hostname === "pipelines.actions.githubusercontent.com") {
			return reply(oidcBody);
		}
		if (parsed.pathname === "/login/oauth/token") {
			return reply(exchangeBody, exchangeStatus);
		}
		if (parsed.pathname === "/login/oauth/token/revoke") return reply(undefined, 204);
		throw new Error("Unexpected request");
	};
	return { calls, masks, fetchImpl, maskToken: (token) => masks.push(token) };
}

test("exchanges GitHub OIDC for VCR access and revokes it after retention", async () => {
	const fake = harness();
	const events = [];
	const result = await retainImagesWithOidc({
		env,
		apply: true,
		...fake,
		retain: async (options) => {
			events.push("retain");
			assert.deepEqual(fake.masks, ["vcr.access.token"]);
			assert.equal(options.token, "metadata-token");
			assert.equal(options.registryToken, "vcr.access.token");
			assert.equal(options.teamId, "team_123");
			assert.equal(options.projectId, "prj_456");
			assert.equal(options.githubToken, "github-token");
			assert.equal(options.apply, true);
			return { deleted: 1 };
		},
	});
	assert.deepEqual(result, { deleted: 1 });
	assert.equal(fake.calls.length, 3);
	const [oidc, exchange, revoke] = fake.calls;
	assert.equal(oidc.url.searchParams.get("audience"), "https://github.com/karimsa");
	assert.equal(oidc.url.searchParams.get("existing"), "1");
	assert.equal(oidc.request.headers.Authorization, "Bearer actions-request-token");
	assert.equal(exchange.request.method, "POST");
	assert.equal(exchange.request.headers["Content-Type"], "application/x-www-form-urlencoded");
	assert.deepEqual(Object.fromEntries(exchange.request.body), {
		grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
		client_id: "cl_inrfNy8noLlhRrGbPEm0z47woXNcJVZ0",
		subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
		requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
		team_id_or_slug: "team_123",
		subject_token: "github.oidc.token",
	});
	assert.equal(revoke.url.pathname, "/login/oauth/token/revoke");
	assert.equal(revoke.request.method, "POST");
	assert.deepEqual(Object.fromEntries(revoke.request.body), {
		client_id: "cl_inrfNy8noLlhRrGbPEm0z47woXNcJVZ0",
		token: "vcr.access.token",
		token_type_hint: "access_token",
	});
	assert.deepEqual(events, ["retain"]);
});

test("revokes VCR access even when retention fails", async () => {
	const fake = harness();
	await assert.rejects(
		retainImagesWithOidc({
			env,
			...fake,
			retain: async () => {
				throw new Error("Retention failed");
			},
		}),
		/Retention failed/,
	);
	assert.equal(fake.calls.at(-1).url.pathname, "/login/oauth/token/revoke");
	assert.deepEqual(fake.masks, ["vcr.access.token"]);
});

test("rejects unauthorized exchange and malformed tokens without starting retention", async () => {
	for (const options of [
		{ exchangeStatus: 403 },
		{ oidcBody: { value: "bad\nvalue" } },
		{ exchangeBody: { access_token: "bad\nvalue" } },
	]) {
		const fake = harness(options);
		let retained = false;
		await assert.rejects(
			retainImagesWithOidc({
				env,
				...fake,
				retain: async () => {
					retained = true;
				},
			}),
			(error) => {
				assert.ok(!error.message.includes("github.oidc.token"));
				assert.ok(!error.message.includes("vcr.access.token"));
				return /HTTP 403|invalid token response/.test(error.message);
			},
		);
		assert.equal(retained, false);
		assert.deepEqual(fake.masks, []);
	}
});

test("rejects an OIDC URL outside GitHub Actions before requesting a token", async () => {
	const fake = harness();
	await assert.rejects(
		retainImagesWithOidc({
			env: { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.com/oidc" },
			...fake,
			retain: async () => {
				throw new Error("Should not run");
			},
		}),
		/URL is invalid/,
	);
	assert.deepEqual(fake.calls, []);
});
