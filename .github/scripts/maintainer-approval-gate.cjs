const CHECK_NAME = "Maintainer approval";
const MAINTAINER_LOGIN = "karimsa";

// A comment or pending review does not change the most recent decision.
function approvedForHead(reviews, headSha) {
	const decisive = reviews
		.filter(
			(review) =>
				review.user?.login === MAINTAINER_LOGIN &&
				["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state),
		)
		.sort((left, right) => right.id - left.id)[0];
	return decisive?.state === "APPROVED" && decisive.commit_id === headSha;
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
		const workflowUrl = `${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`;
		// An asynchronous gate needs a commit status; an API-created check is not an Actions job.
		// Start a new evaluation before evidence reads so errors clear an old pass.
		await github.rest.repos.createCommitStatus({
			...repo,
			sha: headSha,
			context: CHECK_NAME,
			state: "pending",
			target_url: workflowUrl,
			description: "Checking current-head maintainer approval",
		});
		const reviews =
			pullRequest.user?.login === MAINTAINER_LOGIN
				? []
				: await github.paginate(github.rest.pulls.listReviews, {
						...repo,
						pull_number: pullRequest.number,
						per_page: 100,
					});
		// The list can go stale while reviews load. Publish only for its original head.
		const { data: current } = await github.rest.pulls.get({
			...repo,
			pull_number: pullRequest.number,
		});
		if (current.head.sha !== headSha || current.state !== "open") continue;
		const isAuthor = current.user?.login === MAINTAINER_LOGIN;
		const approved = isAuthor || approvedForHead(reviews, headSha);
		await github.rest.repos.createCommitStatus({
			...repo,
			sha: headSha,
			context: CHECK_NAME,
			state: approved ? "success" : "failure",
			target_url: workflowUrl,
			description: isAuthor
				? "Maintainer authored this PR"
				: approved
					? "Maintainer approved this head"
					: "Maintainer approval required for this head",
		});
		core.info(
			`PR #${pullRequest.number}: maintainer approval ${approved ? "confirmed" : "required"} for ${headSha}`,
		);
	}
}

module.exports = { approvedForHead, reconcile };
