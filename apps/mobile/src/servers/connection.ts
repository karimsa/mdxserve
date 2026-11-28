import type { ServerInfo } from "@mdxserve/shared/server-info";
import { orderedAddresses, type KnownServer } from "./store";

/**
 * What asking one address for `getServerInfo` gave.
 * @internal Exported for its tests.
 */
export type ProbeResult = { kind: "ok"; info: ServerInfo } | { kind: "failed"; cause: string };

/** Ask `origin` what server it is; never rejects. */
export type Probe = (origin: string) => Promise<ProbeResult>;

/** How the app can reach a known server right now. */
export type Connection =
	/** `origin` answered with the server's id. */
	| { kind: "reachable"; origin: string; info: ServerInfo }
	/** No address answered with the server's id, and these answered as another server. */
	| { kind: "changed"; origins: string[] }
	/** No address answered as an mdxserve server. */
	| { kind: "unreachable"; causes: Array<{ origin: string; cause: string }> };

/**
 * The first of the server's addresses, in `orderedAddresses` order, that answers
 * `getServerInfo` with the stored id. An address that answers with another id is never used.
 * Every address is asked at once, so the check takes as long as the slowest address it has to
 * wait for (C6), and an answer is taken as soon as every address ahead of it has settled: the
 * result is the one asking them one after another would give.
 */
export async function connect(server: KnownServer, probe: Probe): Promise<Connection> {
	const asked = orderedAddresses(server).map((address) => ({
		origin: address.url,
		answer: probe(address.url),
	}));
	const changed: string[] = [];
	const causes: Array<{ origin: string; cause: string }> = [];
	for (const { origin, answer } of asked) {
		const result = await answer;
		if (result.kind === "failed") {
			causes.push({ origin, cause: result.cause });
		} else if (result.info.id === server.id) {
			return { kind: "reachable", origin, info: result.info };
		} else {
			changed.push(origin);
		}
	}
	return changed.length > 0
		? { kind: "changed", origins: changed }
		: { kind: "unreachable", causes };
}
