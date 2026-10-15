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

function gateStatus(state, description, creator = { login: "github-actions[bot]", type: "Bot" }) {
	return { context: "Maintainer approval", state, description, creator };
}

function harness({
	pullRequests = [{ number: 2, head: { sha: headSha }, user: { login: "contributor" } }],
	reviews = [review(1, "APPROVED")],
	currentHead = headSha,
	currentAuthor = "contributor",
	currentState = "open",
	initialStatuses = [],
	eventName = "workflow_run",
	eventPayload = { workflow_run: { name: "Verify PR" } },
	failReviews = false,
	holdReviews = false,
	failStatuses = false,
	failWrite = false,
} = {}) {
	const writes = [];
	const events = [];
	let currentReviews = reviews;
	let currentEventName = eventName;
	let currentPayload = eventPayload;
	let releaseReviews;
	const heldReviews = holdReviews
		? new Promise((resolve) => {
				releaseReviews = resolve;
			})
		: undefined;
	let statuses = initialStatuses;
	const pulls = {
		list() {},
		listReviews() {},
		async get() {
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
		listCommitStatusesForRef() {},
		async createCommitStatus(payload) {
			if (failWrite) throw new Error("Status API unavailable");
			writes.push(payload);
			events.push(payload.state);
			statuses = [gateStatus(payload.state, payload.description), ...statuses];
		},
	};
	const github = {
		rest: { pulls, repos },
		async paginate(method, options) {
			if (method === pulls.list) return pullRequests;
			if (method === repos.listCommitStatusesForRef) {
				events.push("statuses");
				assert.equal(options.ref, headSha);
				if (failStatuses) throw new Error("Status list unavailable");
				return statuses;
			}
			if (method === pulls.listReviews) {
				events.push("reviews");
				assert.equal(options.pull_number, 2);
				if (heldReviews) await heldReviews;
				if (failReviews) throw new Error("API unavailable");
				return currentReviews;
			}
			throw new Error("Unexpected API call");
		},
	};
	return {
		writes,
		events,
		releaseReviews: () => releaseReviews?.(),
		setReviews(next) {
			currentReviews = next;
		},
		setEvent(nextName, nextPayload) {
			currentEventName = nextName;
			currentPayload = nextPayload;
		},
		run: () =>
			reconcile({
				github,
				context: {
					eventName: currentEventName,
					payload: currentPayload,
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
	assert.deepEqual(fixture.events, ["statuses", "get", "success"]);
	assertStatus(fixture.writes[0], "success");
});

test("accepts current-head approval and skips unchanged repeats", async () => {
	const fixture = harness();
	for (let count = 0; count < 501; count += 1) await fixture.run();
	assert.equal(fixture.events.filter((event) => event === "reviews").length, 1);
	assert.deepEqual(
		fixture.writes.map((write) => write.state),
		["success"],
	);
	assertStatus(fixture.writes[0], "success");
});

test("review changes, branch pushes and synchronization clear success before reads", async () => {
	for (const event of [
		{
			eventName: "workflow_run",
			eventPayload: { workflow_run: { name: "PR review changed", pull_requests: [] } },
		},
		{ eventName: "push", eventPayload: { ref: "refs/heads/main" } },
		{
			eventName: "pull_request_target",
			eventPayload: { action: "synchronize", pull_request: { number: 2 } },
		},
	]) {
		const fixture = harness({
			...event,
			initialStatuses: [gateStatus("success", "Maintainer approved this head")],
			holdReviews: true,
		});
		const running = fixture.run();
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual(fixture.events, ["statuses", "pending", "reviews"]);
		fixture.releaseReviews();
		await running;
		assert.deepEqual(
			fixture.writes.map((write) => write.state),
			["pending", "success"],
		);
	}
});

test("review change for another PR does not refresh an existing success", async () => {
	const fixture = harness({
		initialStatuses: [gateStatus("success", "Maintainer approved this head")],
		eventName: "workflow_run",
		eventPayload: { workflow_run: { name: "PR review changed", pull_requests: [{ number: 3 }] } },
	});
	await fixture.run();
	assert.deepEqual(fixture.events, ["statuses"]);
});

test("writes failure once while approval is missing", async () => {
	for (const reviews of [
		[review(1, "APPROVED"), review(2, "DISMISSED")],
		[review(1, "APPROVED"), review(2, "CHANGES_REQUESTED")],
		[review(1, "APPROVED", { commit_id: oldSha })],
		[],
	]) {
		const fixture = harness({ reviews });
		await fixture.run();
		await fixture.run();
		assert.deepEqual(
			fixture.writes.map((write) => write.state),
			["failure"],
		);
		assertStatus(fixture.writes[0], "failure");
	}
});

test("updates a status when approval is invalidated or restored", async () => {
	const fixture = harness();
	await fixture.run();
	fixture.setReviews([review(1, "APPROVED"), review(2, "DISMISSED")]);
	fixture.setEvent("workflow_run", {
		workflow_run: { name: "PR review changed", pull_requests: [] },
	});
	await fixture.run();
	await fixture.run();
	fixture.setReviews([review(1, "APPROVED"), review(2, "DISMISSED"), review(3, "APPROVED")]);
	await fixture.run();
	assert.deepEqual(
		fixture.writes.map((write) => write.state),
		["success", "pending", "failure", "success"],
	);
});

test("does not trust a same-context status from another creator", async () => {
	const fixture = harness({
		initialStatuses: [
			gateStatus("success", "Maintainer approved this head", { login: "other-user", type: "User" }),
			gateStatus("success", "Maintainer approved this head"),
		],
	});
	await fixture.run();
	assert.deepEqual(
		fixture.writes.map((write) => write.state),
		["success"],
	);
});

test("moves an old pass to pending for a moved or closed PR", async () => {
	for (const options of [{ currentHead: oldSha }, { currentState: "closed" }]) {
		const fixture = harness({
			...options,
			eventName: "workflow_dispatch",
			initialStatuses: [gateStatus("success", "Maintainer approved this head")],
		});
		await fixture.run();
		assert.deepEqual(
			fixture.writes.map((write) => write.state),
			["pending"],
		);
	}
});

test("publishes pending on evidence or status-list API errors after success", async () => {
	for (const options of [{ failReviews: true }, { failStatuses: true }]) {
		const fixture = harness({
			...options,
			eventName: "workflow_dispatch",
			initialStatuses: [gateStatus("success", "Maintainer approved this head")],
		});
		await assert.rejects(fixture.run(), /unavailable/);
		assert.deepEqual(
			fixture.writes.map((write) => write.state),
			["pending"],
		);
	}
});

test("does not read evidence when the status-list fallback write fails", async () => {
	const fixture = harness({ failStatuses: true, failWrite: true });
	await assert.rejects(fixture.run(), /Status API unavailable/);
	assert.deepEqual(fixture.writes, []);
	assert.deepEqual(fixture.events, ["statuses"]);
});
