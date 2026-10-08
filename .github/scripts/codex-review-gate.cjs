const CHECK_NAME = "Codex review completed";
const CODEX_LOGIN = "chatgpt-codex-connector[bot]";
const SUMMARY_MARKER = "<!-- codex-pull-request-review-summary -->";

// The summary also covers clean reviews, which may only produce a thumbs-up
// rather than a submitted GitHub review. Never trust a PR author's own text or
// an emoji alone. Unknown formats and ambiguous commit prefixes stay pending.
function completedReview(comments, headSha, commitShas) {
	const summaries = comments
		.filter(
			(comment) =>
				comment.user?.login === CODEX_LOGIN &&
				comment.user?.type === "Bot" &&
				comment.body?.startsWith(SUMMARY_MARKER),
		)
		.sort((left, right) => right.id - left.id);
	const summary = summaries[0];
	if (!summary) return undefined;
	const rows = summary.body.split("\n").filter((line) => line.startsWith("|"));
	for (const row of rows) {
		const columns = row.split("|").map((column) => column.trim());
		if (columns[1] !== "📝 **Code Review**") continue;
		if (!/^✅ \*\*Completed\*\*(?:\s|$)/u.test(columns[2])) continue;
		const prefix = /^`([a-f0-9]{7,40})`$/.exec(columns[3])?.[1];
		if (!prefix || !headSha.startsWith(prefix)) continue;
		const matchingCommits = new Set(
			[...commitShas, headSha].filter((commit) => commit.startsWith(prefix)),
		);
		if (matchingCommits.size === 1) return summary;
	}
	return undefined;
}

async function reconcile({ github, context, core }) {
	const repo = context.repo;
	const pullRequests = await github.paginate(github.rest.pulls.list, {
		...repo,
		state: "open",
		per_page: 100,
	});
	for (const pullRequest of pullRequests) {
		const headSha = pullRequest.head.sha;
		const externalId = `codex-review-gate:${pullRequest.number}`;
		const existing = await github.paginate(github.rest.checks.listForRef, {
			...repo,
			ref: headSha,
			check_name: CHECK_NAME,
			per_page: 100,
		});
		const previous = existing.find(
			(check) => check.app?.slug === "github-actions" && check.external_id === externalId,
		);
		const pending = {
			...repo,
			name: CHECK_NAME,
			status: "in_progress",
			output: {
				title: "Waiting for a completed Codex code review",
				summary: `Codex must finish reviewing commit ${headSha}. Request a new review with @codex review. Findings do not fail this completion gate.`,
			},
		};
		// Reset before reading evidence: API errors must not preserve a stale pass.
		const { data: check } = previous
			? await github.rest.checks.update({ ...pending, check_run_id: previous.id })
			: await github.rest.checks.create({
					...pending,
					head_sha: headSha,
					external_id: externalId,
				});
		const comments = await github.paginate(github.rest.issues.listComments, {
			...repo,
			issue_number: pullRequest.number,
			per_page: 100,
		});
		const commits = await github.paginate(github.rest.pulls.listCommits, {
			...repo,
			pull_number: pullRequest.number,
			per_page: 100,
		});
		// GitHub caps this endpoint at 250 commits; don't trust a shortened SHA
		// if we cannot inspect the complete PR history for an ambiguous prefix.
		const { data: current } = await github.rest.pulls.get({
			...repo,
			pull_number: pullRequest.number,
		});
		if (current.head.sha !== headSha || current.commits > commits.length) continue;
		const summary = completedReview(
			comments,
			headSha,
			commits.map((commit) => commit.sha),
		);
		if (!summary) continue;
		await github.rest.checks.update({
			...repo,
			check_run_id: check.id,
			status: "completed",
			conclusion: "success",
			details_url: summary.html_url,
			output: {
				title: "Codex code review completed",
				summary: `Codex completed a code review of ${headSha}. This confirms review completion, not approval or absence of findings.`,
			},
		});
		core.info(`PR #${pullRequest.number}: completed Codex review for ${headSha}`);
	}
}

module.exports = { completedReview, reconcile };
