import { TAILNET_URLS_MAX, type ServerInfo } from "@mdxserve/shared/server-info";
import { DOCUMENT_SCHEMA_VERSION } from "../document/schema.js";
import type { PermissionMode } from "../servers/bind-host.js";

/** What a server is, fixed for the life of the process. */
export interface ServerIdentity {
	id: string;
	name: string;
	version: string;
	permissions: PermissionMode;
	mermaidVersion: string;
}

/** The `Host` values `tailscale serve` publishes the server under (`TailnetHosts`). */
interface TailnetHostSource {
	current(): ReadonlySet<string>;
}

export type ServerInfoResult = { kind: "ok"; info: ServerInfo };

/**
 * Says what this server is, so a client reaching it by any address can tell which server it
 * reached. It knows nothing about the mounted roots, so it cannot leak their names or paths.
 * Without a tailnet source (`--no-tailscale`) it reports no tailnet addresses.
 */
export class ServerInfoService {
	constructor(
		private readonly identity: ServerIdentity,
		private readonly tailnet: TailnetHostSource | undefined,
	) {}

	info(): ServerInfoResult {
		const hosts = [...(this.tailnet?.current() ?? [])].sort();
		return {
			kind: "ok",
			info: {
				...this.identity,
				treeSchemaVersion: DOCUMENT_SCHEMA_VERSION,
				// A `Host` value already omits the port for 443, so it is the origin's authority.
				tailnetUrls: hosts.slice(0, TAILNET_URLS_MAX).map((host) => `https://${host}`),
			},
		};
	}
}
