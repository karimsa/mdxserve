import { z } from "zod";

/**
 * What a server says about itself through `getServerInfo`. The server validates its answer
 * against this schema and a client validates what it receives against it, so the two cannot
 * drift. It never carries a mounted folder's name or path.
 */

/** A server name is at most 63 bytes of UTF-8, the length of one DNS label. */
export const SERVER_NAME_MAX_BYTES = 63;

/** At most this many tailnet addresses are reported. */
export const TAILNET_URLS_MAX = 8;

export const serverInfoSchema = z.object({
	/** Written once to `MDXSERVE_HOME/config.json`; the same however the server is reached. */
	id: z.uuid(),
	/** `serve --name`, or the computer's hostname. */
	name: z.string().min(1).max(SERVER_NAME_MAX_BYTES),
	/** The mdxserve version. */
	version: z.string(),
	permissions: z.enum(["full", "restricted"]),
	/** The mermaid.js version the server validates diagrams with. */
	mermaidVersion: z.string(),
	/** The `schemaVersion` of the document trees `getDocument` returns. */
	treeSchemaVersion: z.number().int(),
	/** The `https://` origins `tailscale serve` publishes this server under. */
	tailnetUrls: z.array(z.url()).max(TAILNET_URLS_MAX),
});

export type ServerInfo = z.infer<typeof serverInfoSchema>;
