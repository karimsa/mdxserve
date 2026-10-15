const ACTIONS_LOGIN = "github-actions[bot]";

async function createGateStatusPublisher({
	github,
	repo,
	sha,
	context,
	pendingDescription,
	pendingUrl,
}) {
	let state;
	let description;
	const publish = async (nextState, nextDescription, targetUrl) => {
		if (state === nextState && description === nextDescription) return;
		await github.rest.repos.createCommitStatus({
			...repo,
			sha,
			context,
			state: nextState,
			description: nextDescription,
			target_url: targetUrl,
		});
		state = nextState;
		description = nextDescription;
	};
	try {
		const statuses = await github.paginate(github.rest.repos.listCommitStatusesForRef, {
			...repo,
			ref: sha,
			per_page: 100,
		});
		if (!Array.isArray(statuses)) throw new Error("GitHub returned invalid commit statuses");
		const latest = statuses.find((status) => status.context === context);
		if (latest?.creator?.login === ACTIONS_LOGIN && latest.creator.type === "Bot") {
			state = latest.state;
			description = latest.description;
		}
	} catch (error) {
		await publish("pending", pendingDescription, pendingUrl);
		throw error;
	}
	return publish;
}

module.exports = { createGateStatusPublisher };
