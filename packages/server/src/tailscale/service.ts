import { tailscaleCandidates } from "./locate.js";
import {
	matchingAddresses,
	parseServeStatus,
	parseStatus,
	unsupportedPaths,
	type ServerEndpoint,
	type TailnetAddress,
} from "./serve-config.js";

/**
 * Runs one CLI call to completion. It rejects with an error whose `code` is
 * `ENOENT` when the executable does not exist, and with any other error when
 * the call could not finish (a timeout, too much output).
 */
export type TailscaleRunner = (
	command: string,
	args: string[],
) => Promise<{ code: number; stdout: string }>;

export type TailscaleDetection =
	| { kind: "not-found" }
	| { kind: "not-running"; state: string }
	| { kind: "failed"; message: string }
	| {
			kind: "running";
			/** The CLI that answered, as it should be typed: `tailscale` when it is on `PATH`. */
			cli: string;
			/** `Self.DNSName` without the trailing dot. Empty when MagicDNS is off. */
			dnsName: string;
			addresses: TailnetAddress[];
			/** Entries that point at this server's port under a path other than `/`. */
			unsupportedPaths: string[];
			/** An HTTPS port the hint can suggest: the server's port unless the serve config already uses it. */
			suggestedHttpsPort: number;
	  };

type CallOutcome =
	{ kind: "missing" } | { kind: "error"; message: string } | { kind: "ok"; json: unknown };

/** The ports Tailscale Funnel accepts, tried after the server's own. */
const FALLBACK_HTTPS_PORTS = [443, 8443, 10000];

function suggestPort(serverPort: number, usedPorts: number[]): number {
	const used = new Set(usedPorts);
	for (const candidate of [serverPort, ...FALLBACK_HTTPS_PORTS]) {
		if (!used.has(candidate)) return candidate;
	}
	let candidate = serverPort + 1;
	while (used.has(candidate) && candidate < 65535) candidate += 1;
	return candidate;
}

/** Finds the Tailscale CLI and reads what `tailscale serve` publishes of this server. */
export class TailscaleService {
	constructor(
		private readonly run: TailscaleRunner,
		private readonly platform: NodeJS.Platform,
		private readonly env: NodeJS.ProcessEnv,
	) {}

	private async call(cli: string, args: string[]): Promise<CallOutcome> {
		let result: { code: number; stdout: string };
		try {
			result = await this.run(cli, args);
		} catch (error) {
			const code = (error as { code?: unknown } | null)?.code;
			if (code === "ENOENT") return { kind: "missing" };
			const reason = error instanceof Error ? error.message : String(error);
			return { kind: "error", message: `${cli} ${args.join(" ")}: ${reason}` };
		}
		if (result.code !== 0) {
			return { kind: "error", message: `${cli} ${args.join(" ")} exited with ${result.code}` };
		}
		try {
			return { kind: "ok", json: JSON.parse(result.stdout) as unknown };
		} catch {
			return { kind: "error", message: `${cli} ${args.join(" ")} did not print JSON` };
		}
	}

	/**
	 * What Tailscale publishes of the server at `server`. Never throws: a
	 * runner that throws anything, a CLI that hangs or prints something else,
	 * is a `failed` result.
	 */
	async detect(server: ServerEndpoint): Promise<TailscaleDetection> {
		try {
			return await this.detectOnce(server);
		} catch (error) {
			return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
		}
	}

	private async detectOnce(server: ServerEndpoint): Promise<TailscaleDetection> {
		for (const cli of tailscaleCandidates(this.platform, this.env)) {
			// Only this node's state and name are read; leaving peers out keeps a
			// large tailnet's status under the runner's output bound.
			const status = await this.call(cli, ["status", "--json", "--peers=false"]);
			if (status.kind === "missing") continue;
			if (status.kind === "error") return { kind: "failed", message: status.message };
			const self = parseStatus(status.json);
			if (self === undefined) {
				return { kind: "failed", message: `${cli} status --json printed an unexpected shape` };
			}
			if (self.state !== "Running") return { kind: "not-running", state: self.state };

			const serve = await this.call(cli, ["serve", "status", "--json"]);
			if (serve.kind === "missing") return { kind: "failed", message: `${cli} disappeared` };
			if (serve.kind === "error") return { kind: "failed", message: serve.message };
			const config = parseServeStatus(serve.json);
			if (config === undefined) {
				return {
					kind: "failed",
					message: `${cli} serve status --json printed an unexpected shape`,
				};
			}
			return {
				kind: "running",
				cli,
				dnsName: self.dnsName,
				addresses: matchingAddresses(config.entries, server),
				unsupportedPaths: unsupportedPaths(config.entries, server),
				suggestedHttpsPort: suggestPort(server.port, config.usedPorts),
			};
		}
		return { kind: "not-found" };
	}
}
