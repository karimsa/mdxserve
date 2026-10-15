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
	failComments = false,
	failPending = false,
} = {}) {
	const writes = [];
	const reads = [];
	const events = [];
	const pulls = {
		list() {},
		listCommits() {},
		async get() {
			reads.push("get");
			events.push("get");
			return { data: { head: { sha: currentHead }, state: currentState, commits: currentCommits } };
		},
	};
	const issues = { listComments() {} };
	const repos = {
		async createCommitStatus(payload) {
			if (failPending && payload.state === "pending") throw new Error("Status API unavailable");
			writes.push(payload);
			events.push(payload.state);
		},
	};
	const github = {
		rest: { pulls, issues, repos },
		async paginate(method) {
			if (method === pulls.list) return [{ number: 2, head: { sha: headSha } }];
			if (method === pulls.listCommits) {
				reads.push("commits");
				events.push("commits");
				return [{ sha: headSha }];
			}
			if (method === issues.listComments) {
				reads.push("comments");
				events.push("comments");
				if (failComments) throw new Error("API unavailable");
				return comments;
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

test("publishes success only after checking evidence for the current head", async () => {
	const fixture = harness();
	await fixture.run();
	assert.deepEqual(fixture.reads, ["comments", "commits", "get"]);
	assert.deepEqual(fixture.events, ["pending", "comments", "commits", "get", "success"]);
	assert.deepEqual(
		fixture.writes.map((write) => write.state),
		["pending", "success"],
	);
	for (const write of fixture.writes) {
		assert.equal(write.sha, headSha);
		assert.equal(write.context, "Codex review completed");
		assert.ok(write.description.length <= 140);
	}
	assert.equal(
		fixture.writes[0].target_url,
		"https://github.com/karimsa/mdxserve/actions/runs/456",
	);
	assert.equal(fixture.writes[1].target_url, summary().html_url);
});

test("stays pending on missing, invalidated, moved, closed, or incomplete evidence", async () => {
	for (const options of [
		{ comments: [] },
		{
			comments: [
				summary(),
				summary({ id: 124, body: summary().body.replace("Completed", "Running") }),
			],
		},
		{ currentHead: "abc1234" },
		{ currentState: "closed" },
		{ currentCommits: 2 },
	]) {
		const fixture = harness(options);
		await fixture.run();
		assert.equal(fixture.writes.length, 1);
		assert.equal(fixture.writes[0].state, "pending");
	}
});

test("clears a previous pass before a failed API read", async () => {
	const fixture = harness({ failComments: true });
	await assert.rejects(fixture.run(), /API unavailable/);
	assert.equal(fixture.writes.length, 1);
	assert.equal(fixture.writes[0].state, "pending");
	assert.deepEqual(fixture.events, ["pending", "comments"]);
	assert.deepEqual(fixture.reads, ["comments"]);
});

test("does not read evidence when the pending status write fails", async () => {
	const fixture = harness({ failPending: true });
	await assert.rejects(fixture.run(), /Status API unavailable/);
	assert.deepEqual(fixture.writes, []);
	assert.deepEqual(fixture.reads, []);
});
