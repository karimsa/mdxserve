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
		const externalId = `maintainer-approval-gate:${pullRequest.number}`;
		const existing = await github.paginate(github.rest.checks.listForRef, {
			...repo,
			ref: headSha,
			check_name: CHECK_NAME,
			per_page: 100,
		});
		const previous = existing.find(
			(check) =>
				check.app?.slug === "github-actions" &&
				check.external_id === externalId &&
				check.status !== "completed",
		);
		const pending = {
			...repo,
			name: CHECK_NAME,
			status: "in_progress",
			output: {
				title: "Waiting for maintainer approval",
				summary: `PR #${pullRequest.number} needs approval from ${MAINTAINER_LOGIN} for commit ${headSha}, unless ${MAINTAINER_LOGIN} authored it.`,
			},
		};
		// Create a fresh evaluation after a completed check. Start it before reading
		// evidence so API errors cannot leave the old result as the latest one.
		const { data: check } = previous
			? await github.rest.checks.update({ ...pending, check_run_id: previous.id })
			: await github.rest.checks.create({
					...pending,
					head_sha: headSha,
					external_id: externalId,
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
		await github.rest.checks.update({
			...repo,
			check_run_id: check.id,
			status: "completed",
			conclusion: approved ? "success" : "failure",
			output: {
				title: approved ? "Maintainer approval confirmed" : "Maintainer approval required",
				summary: isAuthor
					? `${MAINTAINER_LOGIN} authored PR #${pullRequest.number} at ${headSha}.`
					: approved
						? `${MAINTAINER_LOGIN} approved commit ${headSha}.`
						: `${MAINTAINER_LOGIN} must approve the current head commit ${headSha}. A dismissed review or request for changes removes an earlier approval.`,
			},
		});
		core.info(
			`PR #${pullRequest.number}: maintainer approval ${approved ? "confirmed" : "required"} for ${headSha}`,
		);
	}
}

module.exports = { approvedForHead, reconcile };
