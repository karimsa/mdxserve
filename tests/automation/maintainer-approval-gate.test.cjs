const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
	approvedForHead,
	reconcile,
} = require("../../.github/scripts/maintainer-approval-gate.cjs");

const headSha = "f813ba871764ed9a5bf316400d6367dd666da5dc";
const oldSha = "e6a662aff04ddc24c28e9aab7a92d32ad6fe8560";
const workflowUrl = "https://github.com/karimsa/mdxserve/actions/runs/456";

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
	currentHead = headSha,
	currentAuthor = "contributor",
	currentState = "open",
	failReviews = false,
	failPending = false,
} = {}) {
	const writes = [];
	const reads = [];
	const events = [];
	const pulls = {
		list() {},
		listReviews() {},
		async get() {
			reads.push("get");
			events.push("get");
			return {
				data: {
					head: { sha: currentHead },
					user: { login: currentAuthor },
					state: currentState,
				},
			};
		},
	};
	const repos = {
		async createCommitStatus(payload) {
			if (failPending && payload.state === "pending") throw new Error("Status API unavailable");
			writes.push(payload);
			events.push(payload.state);
		},
	};
	const github = {
		rest: { pulls, repos },
		async paginate(method, options) {
			if (method === pulls.list) return pullRequests;
			if (method === pulls.listReviews) {
				reads.push(`reviews:${options.pull_number}:${options.per_page}`);
				events.push("reviews");
				if (failReviews) throw new Error("API unavailable");
				return reviews;
			}
			throw new Error("Unexpected API call");
		},
	};
	return {
		writes,
		reads,
		events,
		run: () =>
			reconcile({
				github,
				context: {
					repo: { owner: "karimsa", repo: "mdxserve" },
					serverUrl: "https://github.com",
					runId: 456,
				},
				core: { info() {} },
			}),
	};
}

function assertStatus(write, state) {
	assert.equal(write.sha, headSha);
	assert.equal(write.context, "Maintainer approval");
	assert.equal(write.state, state);
	assert.equal(write.target_url, workflowUrl);
	assert.ok(write.description.length <= 140);
}

test("accepts the PR author without reading reviews", async () => {
	const fixture = harness({
		pullRequests: [{ number: 2, head: { sha: headSha }, user: { login: "karimsa" } }],
		currentAuthor: "karimsa",
		failReviews: true,
	});
	await fixture.run();
	assert.deepEqual(fixture.events, ["pending", "get", "success"]);
	assertStatus(fixture.writes[0], "pending");
	assertStatus(fixture.writes[1], "success");
});

test("accepts current-head approval after resetting the status", async () => {
	const fixture = harness();
	await fixture.run();
	assert.deepEqual(fixture.events, ["pending", "reviews", "get", "success"]);
	assertStatus(fixture.writes[0], "pending");
	assertStatus(fixture.writes[1], "success");
});

test("invalidated approval changes the latest status to failure", async () => {
	const fixture = harness({ reviews: [review(1, "APPROVED"), review(2, "DISMISSED")] });
	await fixture.run();
	assert.deepEqual(fixture.events, ["pending", "reviews", "get", "failure"]);
	assertStatus(fixture.writes[1], "failure");
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
		assert.deepEqual(
			fixture.writes.map((write) => write.state),
			["pending", "failure"],
		);
		assertStatus(fixture.writes[1], "failure");
	}
});

test("leaves pending on a moved or closed PR", async () => {
	for (const options of [{ currentHead: oldSha }, { currentState: "closed" }]) {
		const fixture = harness(options);
		await fixture.run();
		assert.deepEqual(
			fixture.writes.map((write) => write.state),
			["pending"],
		);
	}
});

test("fails closed on evidence or pending-status API errors", async () => {
	const failedRead = harness({ failReviews: true });
	await assert.rejects(failedRead.run(), /API unavailable/);
	assert.deepEqual(failedRead.events, ["pending", "reviews"]);

	const failedWrite = harness({ failPending: true });
	await assert.rejects(failedWrite.run(), /Status API unavailable/);
	assert.deepEqual(failedWrite.writes, []);
	assert.deepEqual(failedWrite.reads, []);
});

test("checks every open PR serially", async () => {
	const fixture = harness({
		pullRequests: [
			{ number: 2, head: { sha: headSha }, user: { login: "contributor" } },
			{ number: 3, head: { sha: headSha }, user: { login: "contributor" } },
		],
	});
	await fixture.run();
	assert.deepEqual(fixture.events, [
		"pending",
		"reviews",
		"get",
		"success",
		"pending",
		"reviews",
		"get",
		"success",
	]);
	assert.equal(fixture.writes.length, 4);
});
