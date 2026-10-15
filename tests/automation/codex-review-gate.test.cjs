const assert = require("node:assert/strict");
const { test } = require("node:test");
const { completedReview, reconcile } = require("../../.github/scripts/codex-review-gate.cjs");

const headSha = "f813ba871764ed9a5bf316400d6367dd666da5dc";
function summary(overrides = {}) {
	return {
		id: 123,
		user: { login: "chatgpt-codex-connector[bot]", type: "Bot" },
		body: `<!-- codex-pull-request-review-summary -->
| Review | Status | Commit | Review trigger |
| --- | --- | --- | --- |
| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="2026-10-08T13:45:09Z">now</relative-time> | \`f813ba8\` | Manual request |`,
		html_url: "https://github.com/karimsa/mdxserve/pull/2#issuecomment-123",
		...overrides,
	};
}

test("accepts the observed Codex summary for the current commit", () => {
	const comment = summary();
	assert.equal(completedReview([comment], headSha, [headSha]), comment);
});

test("rejects forged, missing, running, failed, security-only and stale evidence", () => {
	const baseline = summary();
	const invalid = [
		summary({ user: { login: "karimsa", type: "User" } }),
		summary({ user: { login: "chatgpt-codex-connector[bot]", type: "User" } }),
		summary({ body: baseline.body.replace("✅ **Completed**", "🔄 **Running**") }),
		summary({ body: baseline.body.replace("✅ **Completed**", "❌ **Failed**") }),
		summary({ body: baseline.body.replace("Code Review", "Security Review") }),
		summary({ body: baseline.body.replace("f813ba8", "abcdef1") }),
		summary({ body: "👍" }),
		summary({ body: baseline.body.replace("✅ **Completed**", "✅ **Completed**ish") }),
	];
	assert.equal(completedReview([], headSha, [headSha]), undefined);
	for (const comment of invalid) {
		assert.equal(completedReview([comment], headSha, [headSha]), undefined);
	}
});

test("requires the latest summary and rejects ambiguous abbreviated commits", () => {
	const running = summary({
		id: 124,
		body: summary().body.replace("✅ **Completed**", "🔄 **Running**"),
	});
	assert.equal(completedReview([summary(), running], headSha, [headSha]), undefined);
	assert.equal(
		completedReview([summary()], headSha, [headSha, "f813ba80000000000000000000000000000000000"]),
		undefined,
	);
});

function harness({
	comments = [summary()],
	currentHead = headSha,
	currentState = "open",
	currentCommits = 1,
	initialStatuses = [],
	failComments = false,
	failStatuses = false,
	failWrite = false,
} = {}) {
	const writes = [];
	const events = [];
	let currentComments = comments;
	let statuses = initialStatuses;
	const pulls = {
		list() {},
		listCommits() {},
		async get() {
			events.push("get");
			return { data: { head: { sha: currentHead }, state: currentState, commits: currentCommits } };
		},
	};
	const issues = { listComments() {} };
	const repos = {
		listCommitStatusesForRef() {},
		async createCommitStatus(payload) {
			if (failWrite) throw new Error("Status API unavailable");
			writes.push(payload);
			events.push(payload.state);
			statuses = [
				{
					context: payload.context,
					state: payload.state,
					description: payload.description,
					creator: { login: "github-actions[bot]", type: "Bot" },
				},
				...statuses,
			];
		},
	};
	const github = {
		rest: { pulls, issues, repos },
		async paginate(method, options) {
			if (method === pulls.list) return [{ number: 2, head: { sha: headSha } }];
			if (method === repos.listCommitStatusesForRef) {
				events.push("statuses");
				assert.equal(options.ref, headSha);
				if (failStatuses) throw new Error("Status list unavailable");
				return statuses;
			}
			if (method === pulls.listCommits) {
				events.push("commits");
				return [{ sha: headSha }];
			}
			if (method === issues.listComments) {
				events.push("comments");
				if (failComments) throw new Error("API unavailable");
				return currentComments;
			}
			throw new Error("Unexpected API call");
		},
	};
	return {
		writes,
		events,
		setComments(next) {
			currentComments = next;
		},
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

function gateStatus(state, description, creator = { login: "github-actions[bot]", type: "Bot" }) {
	return { context: "Codex review completed", state, description, creator };
}

test("writes success for current evidence and skips unchanged repeats", async () => {
	const fixture = harness();
	await fixture.run();
	assert.deepEqual(fixture.events, ["statuses", "comments", "commits", "get", "success"]);
	assert.deepEqual(
		fixture.writes.map((write) => write.state),
		["success"],
	);
	assert.equal(fixture.writes[0].sha, headSha);
	assert.equal(fixture.writes[0].context, "Codex review completed");
	assert.equal(fixture.writes[0].target_url, summary().html_url);
	assert.ok(fixture.writes[0].description.length <= 140);
	for (let count = 0; count < 501; count += 1) await fixture.run();
	assert.deepEqual(
		fixture.writes.map((write) => write.state),
		["success"],
	);
});

test("writes pending once for missing evidence and after invalidation", async () => {
	const missing = harness({ comments: [] });
	await missing.run();
	await missing.run();
	assert.deepEqual(
		missing.writes.map((write) => write.state),
		["pending"],
	);
	assert.equal(
		missing.writes[0].target_url,
		"https://github.com/karimsa/mdxserve/actions/runs/456",
	);

	const invalidated = harness();
	await invalidated.run();
	invalidated.setComments([
		summary(),
		summary({ id: 124, body: summary().body.replace("Completed", "Running") }),
	]);
	await invalidated.run();
	await invalidated.run();
	assert.deepEqual(
		invalidated.writes.map((write) => write.state),
		["success", "pending"],
	);
});

test("does not trust a same-context status from another creator", async () => {
	const fixture = harness({
		initialStatuses: [
			gateStatus("success", "Codex review completed for this head", {
				login: "other-user",
				type: "User",
			}),
			gateStatus("success", "Codex review completed for this head"),
		],
	});
	await fixture.run();
	assert.deepEqual(
		fixture.writes.map((write) => write.state),
		["success"],
	);
});

test("moves an old pass to pending for stale, closed, or incomplete PR state", async () => {
	for (const options of [
		{ currentHead: "abc1234" },
		{ currentState: "closed" },
		{ currentCommits: 2 },
	]) {
		const fixture = harness({
			...options,
			initialStatuses: [gateStatus("success", "Codex review completed for this head")],
		});
		await fixture.run();
		assert.deepEqual(
			fixture.writes.map((write) => write.state),
			["pending"],
		);
	}
});

test("publishes pending on evidence or status-list API errors after success", async () => {
	for (const options of [{ failComments: true }, { failStatuses: true }]) {
		const fixture = harness({
			...options,
			initialStatuses: [gateStatus("success", "Codex review completed for this head")],
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
