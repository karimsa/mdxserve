import { readPackageVersion } from "../infra/pkg.js";

/** Best-effort update notices for interactive CLI users, never machine output. */
export async function notifyAboutUpdates(): Promise<void> {
	if (
		!process.stdout.isTTY ||
		!process.stderr.isTTY ||
		"NO_UPDATE_NOTIFIER" in process.env ||
		process.argv.some((argument) =>
			["--json", "--no-update-notifier", "--version", "-V", "--help", "-h"].includes(argument),
		)
	) {
		return;
	}

	try {
		// Keep notifier dependencies off the path for noninteractive commands.
		// The library handles CI detection and runs registry checks in a detached
		// child process; this invocation only displays a previously cached update.
		const { default: updateNotifier } = await import("update-notifier");
		updateNotifier({
			pkg: { name: "@karimsa/mdxserve", version: readPackageVersion() },
			updateCheckInterval: 24 * 60 * 60 * 1000,
		}).notify({ defer: false });
	} catch {
		// An optional update notice must never prevent the command from running.
	}
}
