const CHECK_NAME = "Maintainer approval";
const MAINTAINER_LOGIN = "karimsa";
const { createGateStatusPublisher } = require("./gate-status.cjs");

function isIrrelevantEvent(context, pullRequestNumber) {
	if (context.eventName === "push") return false;
	if (context.eventName === "workflow_run") {
		const workflow = context.payload?.workflow_run;
		if (workflow?.name === "Verify PR") return true;
		if (workflow?.name === "PR review changed") {
			const affected = workflow.pull_requests;
			return (
				Array.isArray(affected) &&
				affected.length > 0 &&
				!affected.some((pullRequest) => pullRequest.number === pullRequestNumber)
			);
		}
		return false;
	}
	if (context.eventName === "pull_request_target") {
		const eventNumber = context.payload?.pull_request?.number;
		if (!Number.isInteger(eventNumber)) return false;
		if (eventNumber !== pullRequestNumber) return true;
		return context.payload?.action === "edited";
	}
	return false;
}

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
		const pendingDescription = "Checking current-head maintainer approval";
		// An asynchronous gate needs a commit status; an API-created check is not an Actions job.
		const { publish, previousState } = await createGateStatusPublisher({
			github,
			repo,
			sha: headSha,
			context: CHECK_NAME,
			pendingDescription,
			pendingUrl: workflowUrl,
		});
		if (
			previousState === "success" &&
			(pullRequest.user?.login === MAINTAINER_LOGIN ||
				isIrrelevantEvent(context, pullRequest.number))
		)
			continue;
		if (previousState === "success") await publish("pending", pendingDescription, workflowUrl);
		try {
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
			if (current.head.sha !== headSha || current.state !== "open") {
				await publish("pending", pendingDescription, workflowUrl);
				continue;
			}
			const isAuthor = current.user?.login === MAINTAINER_LOGIN;
			const approved = isAuthor || approvedForHead(reviews, headSha);
			await publish(
				approved ? "success" : "failure",
				isAuthor
					? "Maintainer authored this PR"
					: approved
						? "Maintainer approved this head"
						: "Maintainer approval required for this head",
				workflowUrl,
			);
			core.info(
				`PR #${pullRequest.number}: maintainer approval ${approved ? "confirmed" : "required"} for ${headSha}`,
			);
		} catch (error) {
			await publish("pending", pendingDescription, workflowUrl);
			throw error;
		}
	}
}

module.exports = { approvedForHead, reconcile };
