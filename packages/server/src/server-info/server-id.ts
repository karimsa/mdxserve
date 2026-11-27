import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ensureConfig, readConfig, writeConfig } from "../infra/config.js";

const serverIdSchema = z.uuid();

/**
 * The server's id: read from `serverId` in the config file, or created and written there the
 * first time. Every other key in the file is kept. A `serverId` that is not a UUID is an error,
 * not something to overwrite: replacing it would make every app that knows this server see a
 * different one.
 */
export function readOrCreateServerId(
	configFile: string,
): { kind: "ok"; id: string } | { kind: "error"; message: string } {
	try {
		ensureConfig(configFile);
		const snapshot = readConfig(configFile);
		const stored = snapshot.value.serverId;
		if (stored !== undefined) {
			const parsed = serverIdSchema.safeParse(stored);
			if (!parsed.success) {
				return {
					kind: "error",
					message: `serverId in ${configFile} is not a UUID; fix it or remove the key to create a new one`,
				};
			}
			return { kind: "ok", id: parsed.data };
		}
		const id = randomUUID();
		writeConfig(configFile, snapshot, { serverId: id });
		return { kind: "ok", id };
	} catch (error) {
		return {
			kind: "error",
			message: `could not read or write the server id in ${configFile}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}
