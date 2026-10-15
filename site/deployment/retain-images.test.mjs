import assert from "node:assert/strict";
import test from "node:test";
import { hasPendingRelease, planImageRetention, retainImages } from "./retain-images.mjs";

const productionSha = "a".repeat(40);
const options = { token: "project-token", teamId: "team_123", projectId: "prj_123" };

function image(id, tag, day) {
	return {
		id: `image_${id}`,
		repositoryId: "repo_123",
		kind: "manifest",
		status: "ready",
		createdAt: `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`,
		tags: tag ? [tag] : [],
	};
}

function inventory() {
	return [
		image("production", "a".repeat(12), 1),
		image("newest", "b".repeat(12), 4),
		image("older", "c".repeat(12), 3),
		image("untagged", null, 2),
	];
}

function reply(body) {
	return { ok: true, status: 200, json: async () => body };
}

function harness(startingImages = inventory()) {
	let images = structuredClone(startingImages);
	let currentSha = productionSha;
	let deploymentId = "dpl_Production";
	const deleted = [];
	const calls = [];
	return {
		deleted,
		calls,
		setProduction(sha, id) {
			currentSha = sha;
			deploymentId = id;
		},
		addImage(entry) {
			images.push(entry);
		},
		remaining() {
			return images.map((entry) => entry.id);
		},
		checkRelease: async () => false,
		fetchImpl: async (url, request = {}) => {
			const parsed = new URL(url);
			const pathname = parsed.pathname;
			if (pathname.startsWith("/v1/vcr/repository/site/images")) {
				calls.push({ url: parsed, method: request.method ?? "GET", headers: request.headers });
				if (request.method === "DELETE") {
					const id = decodeURIComponent(pathname.split("/").at(-1));
					deleted.push(id);
					images = images.filter((entry) => entry.id !== id);
					return { ok: true, status: 204 };
				}
				return reply({ images });
			}
			if (pathname.includes("/aliases/")) {
				return reply({
					alias: "mdxserve.karim.build",
					projectId: options.projectId,
					deploymentId,
				});
			}
			return reply({
				id: deploymentId,
				projectId: options.projectId,
				readyState: "READY",
				gitSource: { sha: currentSha },
				meta: { githubCommitSha: currentSha },
			});
		},
	};
}

test("keeps production even when it is old, plus the newest other image", () => {
	const plan = planImageRetention(inventory(), productionSha);
	assert.equal(plan.productionId, "image_production");
	assert.equal(plan.newestId, "image_newest");
	assert.deepEqual(plan.deleteIds, ["image_untagged", "image_older"]);
});

test("an untagged recent image does not occupy the second retained slot", () => {
	const images = inventory().map((entry) =>
		entry.id === "image_untagged" ? { ...entry, createdAt: "2026-10-05T12:00:00.000Z" } : entry,
	);
	const plan = planImageRetention(images, productionSha);
	assert.equal(plan.newestId, "image_newest");
	assert.deepEqual(plan.deleteIds, ["image_older", "image_untagged"]);
});

test("fails closed on missing or ambiguous production images and unexpected tags", () => {
	assert.throws(
		() => planImageRetention(inventory(), "d".repeat(40)),
		/Production image is missing/,
	);
	assert.throws(
		() =>
			planImageRetention([...inventory(), image("duplicate", "a".repeat(12), 5)], productionSha),
		/duplicate tags/,
	);
	assert.throws(
		() =>
			planImageRetention([{ ...inventory()[0], tags: ["a".repeat(12), "extra"] }], productionSha),
		/unexpected image metadata/,
	);
	assert.throws(
		() =>
			planImageRetention(
				[
					{ ...inventory()[0], repositoryId: "repo_123" },
					{ ...inventory()[1], repositoryId: "repo_other" },
				],
				productionSha,
			),
		/unexpected image metadata/,
	);
});

test("previews without deleting and scopes registry requests to the project", async () => {
	const fake = harness();
	const result = await retainImages({ ...options, ...fake });
	assert.equal(result.deleteIds.length, 2);
	assert.deepEqual(fake.deleted, []);
	assert.equal(fake.calls.length, 1);
	assert.equal(fake.calls[0].method, "GET");
	assert.equal(fake.calls[0].url.pathname, "/v1/vcr/repository/site/images");
	assert.equal(fake.calls[0].url.searchParams.get("teamId"), options.teamId);
	assert.equal(fake.calls[0].url.searchParams.get("projectId"), options.projectId);
	assert.equal(fake.calls[0].url.searchParams.get("limit"), "100");
	assert.equal(fake.calls[0].headers.Authorization, "Bearer project-token");
});

test("reads every registry page before planning deletions", async () => {
	const fake = harness();
	const fetchImpl = fake.fetchImpl;
	const cursors = [];
	fake.fetchImpl = async (url, request) => {
		const parsed = new URL(url);
		if (parsed.pathname === "/v1/vcr/repository/site/images") {
			cursors.push(parsed.searchParams.get("cursor"));
			return parsed.searchParams.has("cursor")
				? reply({ images: inventory().slice(2) })
				: reply({ images: inventory().slice(0, 2), nextCursor: "page-two" });
		}
		return fetchImpl(url, request);
	};
	const result = await retainImages({ ...options, ...fake });
	assert.deepEqual(cursors, [null, "page-two"]);
	assert.deepEqual(result.deleteIds, ["image_untagged", "image_older"]);
	assert.deepEqual(fake.deleted, []);
});

test("fails closed on registry HTTP errors, invalid JSON and incomplete pages", async () => {
	for (const [response, message] of [
		[{ ok: false, status: 403 }, /inventory returned HTTP 403/],
		[
			{
				ok: true,
				json: async () => {
					throw new SyntaxError("bad JSON");
				},
			},
			/not valid JSON/,
		],
		[reply({ images: "invalid" }), /unexpected shape/],
		[reply({ images: inventory(), nextCursor: "again" }), /invalid cursor/],
		[reply({ images: Array.from({ length: 100 }, () => inventory()[0]) }), /may be truncated/],
	]) {
		const fake = harness();
		const fetchImpl = fake.fetchImpl;
		let calls = 0;
		fake.fetchImpl = async (url, request) => {
			if (new URL(url).pathname === "/v1/vcr/repository/site/images") {
				calls += 1;
				return response;
			}
			return fetchImpl(url, request);
		};
		await assert.rejects(retainImages({ ...options, ...fake, apply: true }), message);
		assert.deepEqual(fake.deleted, []);
		assert.ok(calls >= 1);
	}
});

test("rechecks the live alias and inventory before each deletion", async () => {
	const fake = harness();
	const fetchImpl = fake.fetchImpl;
	fake.fetchImpl = async (url, request) => {
		const result = await fetchImpl(url, request);
		if (request?.method === "DELETE" && fake.deleted.length === 1) {
			fake.setProduction("c".repeat(40), "dpl_Promoted");
			fake.addImage(image("incoming", "e".repeat(12), 5));
		}
		return result;
	};
	const result = await retainImages({ ...options, ...fake, apply: true });
	assert.equal(result.deleted, 3);
	assert.deepEqual(fake.remaining().sort(), ["image_incoming", "image_older"].sort());
	assert.ok(!fake.deleted.includes("image_older"));
	assert.ok(!fake.deleted.includes("image_incoming"));
	assert.equal(fake.calls.filter((call) => call.method === "GET").length, result.deleted + 1);
	assert.ok(
		fake.calls
			.filter((call) => call.method === "DELETE")
			.every((call) => call.headers.Authorization === "Bearer project-token"),
	);
});

test("does not delete if the live production alias or SHA is untrustworthy", async () => {
	for (const invalid of [{ projectId: "prj_other" }, { deploymentId: "invalid" }]) {
		const fake = harness();
		const fetchImpl = fake.fetchImpl;
		fake.fetchImpl = async (url) => {
			const response = await fetchImpl(url);
			if (new URL(url).pathname.includes("/aliases/")) {
				return reply({ ...(await response.json()), ...invalid });
			}
			return response;
		};
		await assert.rejects(
			retainImages({ ...options, ...fake, apply: true }),
			/invalid project or deployment/,
		);
		assert.deepEqual(fake.deleted, []);
	}
	const fake = harness();
	fake.setProduction("short-sha", "dpl_Production");
	await assert.rejects(
		retainImages({ ...options, ...fake, apply: true }),
		/trustworthy commit SHA/,
	);
	assert.deepEqual(fake.deleted, []);
});

test("stops when Vercel rejects deletion", async () => {
	const fake = harness();
	const fetchImpl = fake.fetchImpl;
	fake.fetchImpl = async (url, request) =>
		request?.method === "DELETE" ? { ok: false, status: 403 } : fetchImpl(url, request);
	await assert.rejects(
		retainImages({ ...options, ...fake, apply: true }),
		/deletion returned HTTP 403/,
	);
	assert.deepEqual(fake.deleted, []);
});

test("defers all deletions while a release is pending", async () => {
	const fake = harness();
	fake.checkRelease = async () => true;
	const result = await retainImages({ ...options, ...fake, apply: true });
	assert.equal(result.deferred, true);
	assert.equal(result.deleted, 0);
	assert.deepEqual(fake.deleted, []);
});

test("stops before the next deletion when a release begins during cleanup", async () => {
	const fake = harness();
	let checks = 0;
	fake.checkRelease = async () => ++checks > 1;
	const result = await retainImages({ ...options, ...fake, apply: true });
	assert.equal(result.deferred, true);
	assert.equal(result.deleted, 1);
	assert.deepEqual(fake.deleted, ["image_untagged"]);
});

test("fails closed when the GitHub release check fails", async () => {
	const fake = harness();
	fake.checkRelease = async () => {
		throw new Error("GitHub unavailable");
	};
	await assert.rejects(retainImages({ ...options, ...fake, apply: true }), /GitHub unavailable/);
	assert.deepEqual(fake.deleted, []);
});

test("checks active Release runs with the GitHub Actions API", async () => {
	const statuses = [];
	const pending = await hasPendingRelease({
		token: "github-token",
		fetchImpl: async (url, request) => {
			assert.equal(request.headers.Authorization, "Bearer github-token");
			statuses.push(new URL(url).searchParams.get("status"));
			return reply({ total_count: statuses.length === 3 ? 1 : 0, workflow_runs: [] });
		},
	});
	assert.equal(pending, true);
	assert.deepEqual(statuses, ["queued", "in_progress", "pending"]);
	await assert.rejects(
		hasPendingRelease({ token: "github-token", fetchImpl: async () => reply({}) }),
		/invalid run metadata/,
	);
	await assert.rejects(
		hasPendingRelease({
			token: "github-token",
			fetchImpl: async () => ({ ok: false, status: 403 }),
		}),
		/HTTP 403/,
	);
});
