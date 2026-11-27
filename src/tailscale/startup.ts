import { tailscaleReport, type ReportContext } from "./report.js";
import { tailscaleRunner } from "./runner.js";
import { TailscaleService } from "./service.js";
import type { ServerEndpoint } from "./serve-config.js";
import { TailnetHosts } from "./tailnet-hosts.js";

/**
 * The per-process tailnet hosts of a server, detected with the real CLI.
 * `endpoint` is read on each detection: it is unknown until the server
 * listens, and detection before that finds nothing.
 */
export function serverTailnetHosts(
	endpoint: () => ServerEndpoint | undefined,
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
): TailnetHosts {
	const service = new TailscaleService(tailscaleRunner(), platform, env);
	return new TailnetHosts(async () => {
		const current = endpoint();
		return current ? service.detect(current) : { kind: "not-found" };
	});
}

/**
 * Detect once and print what the operator should know, all on stderr so
 * stdout stays the banner (and JSON, for a caller that parses it). Resolves
 * when done; never rejects. The server calls it without waiting.
 */
export async function announceTailscale(
	hosts: TailnetHosts,
	context: ReportContext,
): Promise<void> {
	try {
		const lines = tailscaleReport(await hosts.refresh(), context);
		if (lines.length > 0) console.error(lines.join("\n"));
	} catch {
		// Nothing about Tailscale is worth failing a running server for.
	}
}
