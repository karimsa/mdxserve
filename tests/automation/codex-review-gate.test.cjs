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

function harness({ comments = [summary()], currentHead = headSha, failComments = false } = {}) {
	const writes = [];
	const pulls = {
		list() {},
		listCommits() {},
		async get() {
			return { data: { head: { sha: currentHead }, commits: 1 } };
		},
	};
	const issues = { listComments() {} };
	const checks = {
		listForRef() {},
		async create(payload) {
			writes.push(payload);
			return { data: { id: 99 } };
		},
		async update(payload) {
			writes.push(payload);
			return { data: { id: 99 } };
		},
	};
	const github = {
		rest: { pulls, issues, checks },
		async paginate(method) {
			if (method === pulls.list) return [{ number: 2, head: { sha: headSha } }];
			if (method === checks.listForRef)
				return [{ id: 99, external_id: "codex-review-gate:2", app: { slug: "github-actions" } }];
			if (method === pulls.listCommits) return [{ sha: headSha }];
			if (method === issues.listComments) {
				if (failComments) throw new Error("API unavailable");
				return comments;
			}
			throw new Error("Unexpected API call");
		},
	};
	return {
		writes,
		run: () =>
			reconcile({
				github,
				context: { repo: { owner: "karimsa", repo: "mdxserve" } },
				core: { info() {} },
			}),
	};
}

test("publishes success only after checking evidence for the current head", async () => {
	const fixture = harness();
	await fixture.run();
	assert.equal(fixture.writes[0].status, "in_progress");
	assert.equal(fixture.writes[1].conclusion, "success");
	assert.equal(fixture.writes[1].details_url, summary().html_url);
});

test("stays pending on missing evidence or a concurrent push", async () => {
	for (const options of [{ comments: [] }, { currentHead: "abc1234" }]) {
		const fixture = harness(options);
		await fixture.run();
		assert.equal(fixture.writes.length, 1);
		assert.equal(fixture.writes[0].status, "in_progress");
	}
});

test("clears a previous pass before a failed API read", async () => {
	const fixture = harness({ failComments: true });
	await assert.rejects(fixture.run(), /API unavailable/);
	assert.equal(fixture.writes.length, 1);
	assert.equal(fixture.writes[0].status, "in_progress");
});
