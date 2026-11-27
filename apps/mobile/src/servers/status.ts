import type { Connection } from "./connection";
import { TREE_SCHEMA_VERSION } from "./tree-schema";
import type { KnownServer } from "./store";

export interface ServerStatus {
	tone: "ok" | "warn" | "danger" | "muted";
	text: string;
}

/** The line under a server's name in the server list. */
export function describeServer(
	server: KnownServer,
	connection: Connection | undefined,
	checking: boolean,
): ServerStatus {
	if (server.treeSchemaVersion > TREE_SCHEMA_VERSION) {
		return { tone: "warn", text: "Update the app to read this server" };
	}
	if (connection === undefined) {
		return { tone: "muted", text: checking ? "Checking…" : "Not checked yet" };
	}
	switch (connection.kind) {
		case "reachable":
			return { tone: "ok", text: `Reachable at ${new URL(connection.origin).host}` };
		case "changed":
			return {
				tone: "danger",
				text: `${new URL(connection.origins[0]).host} is now a different server`,
			};
		case "unreachable":
			return {
				tone: "danger",
				text: server.addresses.length === 0 ? "No address left" : "Unreachable",
			};
	}
}
