const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
	approvedForHead,
	reconcile,
} = require("../../.github/scripts/maintainer-approval-gate.cjs");

const headSha = "f813ba871764ed9a5bf316400d6367dd666da5dc";
const oldSha = "e6a662aff04ddc24c28e9aab7a92d32ad6fe8560";

function review(id, state, overrides = {}) {
	return {
		id,
		state,
		commit_id: headSha,
		user: { login: "karimsa" },
		...overrides,
	};
}

test("requires the latest decisive maintainer review on the exact head", () => {
	assert.equal(approvedForHead([review(1, "APPROVED")], headSha), true);
	assert.equal(approvedForHead([review(1, "APPROVED", { commit_id: oldSha })], headSha), false);
	assert.equal(
		approvedForHead([review(1, "APPROVED", { user: { login: "someone-else" } })], headSha),
		false,
	);
	assert.equal(approvedForHead([review(1, "APPROVED"), review(2, "COMMENTED")], headSha), true);
	assert.equal(approvedForHead([review(1, "APPROVED"), review(2, "PENDING")], headSha), true);
	for (const state of ["DISMISSED", "CHANGES_REQUESTED"]) {
		assert.equal(approvedForHead([review(1, "APPROVED"), review(2, state)], headSha), false);
	}
	assert.equal(
		approvedForHead([review(1, "CHANGES_REQUESTED"), review(2, "APPROVED")], headSha),
		true,
	);
	assert.equal(approvedForHead([], headSha), false);
});

function harness({
	pullRequests = [{ number: 2, head: { sha: headSha }, user: { login: "contributor" } }],
	reviews = [review(1, "APPROVED")],
	existingChecks = [
		{ id: 99, external_id: "maintainer-approval-gate:2", app: { slug: "github-actions" } },
	],
	currentHead = headSha,
	currentAuthor = "contributor",
	currentState = "open",
	failReviews = false,
} = {}) {
	const writes = [];
	const reads = [];
	const pulls = {
		list() {},
		listReviews() {},
		async get() {
			reads.push("get");
			return {
				data: {
					head: { sha: currentHead },
					user: { login: currentAuthor },
					state: currentState,
				},
			};
		},
	};
	const checks = {
		listForRef() {},
		async create(payload) {
			writes.push(payload);
			return { data: { id: 100 } };
		},
		async update(payload) {
			writes.push(payload);
			return { data: { id: payload.check_run_id } };
		},
	};
	const github = {
		rest: { pulls, checks },
		async paginate(method, options) {
			if (method === pulls.list) return pullRequests;
			if (method === checks.listForRef) return existingChecks;
			if (method === pulls.listReviews) {
				reads.push(`reviews:${options.pull_number}:${options.per_page}`);
				if (failReviews) throw new Error("API unavailable");
				return reviews;
			}
			throw new Error("Unexpected API call");
		},
	};
	return {
		writes,
		reads,
		run: () =>
			reconcile({
				github,
				context: { repo: { owner: "karimsa", repo: "mdxserve" } },
				core: { info() {} },
			}),
	};
}

test("accepts the PR author and does not require a review API read", async () => {
	const fixture = harness({
		pullRequests: [{ number: 2, head: { sha: headSha }, user: { login: "karimsa" } }],
		currentAuthor: "karimsa",
		failReviews: true,
	});
	await fixture.run();
	assert.deepEqual(fixture.reads, ["get"]);
	assert.equal(fixture.writes[0].status, "in_progress");
	assert.equal(fixture.writes[1].conclusion, "success");
});

test("accepts current-head approval and resets the check before reading reviews", async () => {
	const fixture = harness();
	await fixture.run();
	assert.equal(fixture.writes[0].check_run_id, 99);
	assert.equal(fixture.writes[0].status, "in_progress");
	assert.deepEqual(fixture.reads, ["reviews:2:100", "get"]);
	assert.equal(fixture.writes[1].conclusion, "success");
	assert.match(fixture.writes[1].output.summary, new RegExp(headSha));
});

test("fails after dismissal, changed decision, old approval, or no review", async () => {
	for (const reviews of [
		[review(1, "APPROVED"), review(2, "DISMISSED")],
		[review(1, "APPROVED"), review(2, "CHANGES_REQUESTED")],
		[review(1, "APPROVED", { commit_id: oldSha })],
		[],
	]) {
		const fixture = harness({ reviews });
		await fixture.run();
		assert.equal(fixture.writes.length, 2);
		assert.equal(fixture.writes[0].status, "in_progress");
		assert.equal(fixture.writes[1].conclusion, "failure");
		assert.match(fixture.writes[1].output.summary, /must approve the current head commit/);
	}
});

test("ignores a check from another app or PR and creates one on the original head", async () => {
	const fixture = harness({
		existingChecks: [
			{ id: 1, external_id: "maintainer-approval-gate:2", app: { slug: "other-app" } },
			{ id: 2, external_id: "maintainer-approval-gate:3", app: { slug: "github-actions" } },
		],
	});
	await fixture.run();
	assert.equal(fixture.writes[0].head_sha, headSha);
	assert.equal(fixture.writes[0].external_id, "maintainer-approval-gate:2");
	assert.equal(fixture.writes[1].check_run_id, 100);
});

test("clears an old pass before review API failure and does not publish for a moved head", async () => {
	const failed = harness({ failReviews: true });
	await assert.rejects(failed.run(), /API unavailable/);
	assert.equal(failed.writes.length, 1);
	assert.equal(failed.writes[0].status, "in_progress");

	const moved = harness({ currentHead: oldSha });
	await moved.run();
	assert.equal(moved.writes.length, 1);
	assert.equal(moved.writes[0].status, "in_progress");
});

test("checks every open PR serially", async () => {
	const fixture = harness({
		pullRequests: [
			{ number: 2, head: { sha: headSha }, user: { login: "contributor" } },
			{ number: 3, head: { sha: headSha }, user: { login: "contributor" } },
		],
	});
	await fixture.run();
	assert.deepEqual(fixture.reads, ["reviews:2:100", "get", "reviews:3:100", "get"]);
	assert.equal(fixture.writes.length, 4);
});
