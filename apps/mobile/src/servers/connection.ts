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
 */
export async function connect(server: KnownServer, probe: Probe): Promise<Connection> {
	const changed: string[] = [];
	const causes: Array<{ origin: string; cause: string }> = [];
	for (const address of orderedAddresses(server)) {
		const result = await probe(address.url);
		if (result.kind === "failed") {
			causes.push({ origin: address.url, cause: result.cause });
		} else if (result.info.id === server.id) {
			return { kind: "reachable", origin: address.url, info: result.info };
		} else {
			changed.push(address.url);
		}
	}
	return changed.length > 0
		? { kind: "changed", origins: changed }
		: { kind: "unreachable", causes };
}
