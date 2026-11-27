import { serverInfoSchema, type ServerInfo } from "@mdxserve/shared/server-info";
import { z } from "zod";
import type { KeyValueStorage } from "./storage";

/**
 * The one key the server list is stored under.
 * @internal Exported for its tests.
 */
export const SERVERS_KEY = "mdxserve:servers:v1";

/** Where an address came from. Only `manual` is made today; discovery (phase 5) adds the rest. */
const addressSourceSchema = z.enum(["manual", "bonjour-lan", "bonjour-tailnet", "qr"]);

const originSchema = z
	.string()
	.refine((value) => /^https?:\/\/[^/?#]+$/.test(value), { message: "must be an origin" });

const addressSchema = z.object({
	url: originSchema,
	source: addressSourceSchema,
	/** The last time `getServerInfo` at this address answered with the server's id. */
	lastOkAt: z.iso.datetime().optional(),
});

const knownServerSchema = z.object({
	id: serverInfoSchema.shape.id,
	/** The server's own name (`serve --name`). */
	name: serverInfoSchema.shape.name,
	/** The reader's name for it, shown instead of `name` when set. */
	label: z.string().min(1).max(63).optional(),
	version: z.string(),
	permissions: serverInfoSchema.shape.permissions,
	treeSchemaVersion: serverInfoSchema.shape.treeSchemaVersion,
	addedAt: z.iso.datetime(),
	addresses: z.array(addressSchema),
});

const serverListSchema = z.object({ servers: z.array(knownServerSchema) });

export type ServerAddress = z.infer<typeof addressSchema>;
export type KnownServer = z.infer<typeof knownServerSchema>;

/** What the reader sees a server called. */
export function displayName(server: KnownServer): string {
	return server.label ?? server.name;
}

/**
 * Add what an address answered: a new server, or the addresses appended to the server that
 * already has this id (one server however many addresses reach it). `origins` are the address
 * that answered, then its tailnet URLs. An address belongs to one server only, so it leaves any
 * other server that had it. The answering address is marked as just reached.
 */
export function addServer(
	servers: readonly KnownServer[],
	info: ServerInfo,
	origins: readonly string[],
	now: Date,
): KnownServer[] {
	const answered = origins[0];
	const urls = [...new Set(origins)];
	const others = servers
		.filter((server) => server.id !== info.id)
		.map((server) => ({
			...server,
			addresses: server.addresses.filter((address) => !urls.includes(address.url)),
		}));
	const existing = servers.find((server) => server.id === info.id);
	const kept = existing?.addresses ?? [];
	const added = urls
		.filter((url) => !kept.some((address) => address.url === url))
		.map((url): ServerAddress => ({ url, source: "manual" }));
	const addresses = [...kept, ...added].map((address) =>
		address.url === answered ? { ...address, lastOkAt: now.toISOString() } : address,
	);
	const server: KnownServer = {
		id: info.id,
		name: info.name,
		...(existing?.label === undefined ? {} : { label: existing.label }),
		version: info.version,
		permissions: info.permissions,
		treeSchemaVersion: info.treeSchemaVersion,
		addedAt: existing?.addedAt ?? now.toISOString(),
		addresses,
	};
	return existing
		? servers.map((candidate) =>
				candidate.id === info.id
					? server
					: (others.find((other) => other.id === candidate.id) ?? candidate),
			)
		: [...others, server];
}

/** Give a server the reader's own name; an empty name goes back to the server's. */
export function renameServer(
	servers: readonly KnownServer[],
	id: string,
	label: string,
): KnownServer[] {
	const trimmed = label.trim().slice(0, 63);
	return servers.map((server) => {
		if (server.id !== id) return server;
		const { label: _, ...rest } = server;
		return trimmed.length === 0 ? rest : { ...rest, label: trimmed };
	});
}

export function removeServer(servers: readonly KnownServer[], id: string): KnownServer[] {
	return servers.filter((server) => server.id !== id);
}

/** Note that `url` answered with the server's id, and refresh what the server said about itself. */
export function recordReached(
	servers: readonly KnownServer[],
	info: ServerInfo,
	url: string,
	now: Date,
): KnownServer[] {
	return servers.map((server) =>
		server.id !== info.id
			? server
			: {
					...server,
					name: info.name,
					version: info.version,
					permissions: info.permissions,
					treeSchemaVersion: info.treeSchemaVersion,
					addresses: server.addresses.map((address) =>
						address.url === url ? { ...address, lastOkAt: now.toISOString() } : address,
					),
				},
	);
}

/** The order to try a server's addresses in: HTTPS before HTTP, then the most recently reached. */
export function orderedAddresses(server: KnownServer): ServerAddress[] {
	const secure = (address: ServerAddress) => (address.url.startsWith("https://") ? 0 : 1);
	return [...server.addresses].sort(
		(left, right) =>
			secure(left) - secure(right) || (right.lastOkAt ?? "").localeCompare(left.lastOkAt ?? ""),
	);
}

export type LoadResult =
	| { kind: "ok"; servers: KnownServer[] }
	| { kind: "corrupt"; servers: KnownServer[]; message: string };

/**
 * Read the list. A value that fails the schema is reported and read as empty, and is left in
 * storage until the next change replaces it. Two entries with one id (which `addServer` never
 * writes) are merged into the first.
 */
export async function loadServers(storage: KeyValueStorage): Promise<LoadResult> {
	const stored = await storage.getItem(SERVERS_KEY);
	if (stored === null) return { kind: "ok", servers: [] };
	let json: unknown;
	try {
		json = JSON.parse(stored);
	} catch {
		return { kind: "corrupt", servers: [], message: "The saved server list is not JSON." };
	}
	const parsed = serverListSchema.safeParse(json);
	if (!parsed.success) {
		return { kind: "corrupt", servers: [], message: "The saved server list is not valid." };
	}
	const byId = new Map<string, KnownServer>();
	for (const server of parsed.data.servers) {
		const first = byId.get(server.id);
		byId.set(
			server.id,
			first
				? {
						...first,
						addresses: [
							...first.addresses,
							...server.addresses.filter(
								(address) => !first.addresses.some((kept) => kept.url === address.url),
							),
						],
					}
				: server,
		);
	}
	return { kind: "ok", servers: [...byId.values()] };
}

export async function saveServers(
	storage: KeyValueStorage,
	servers: readonly KnownServer[],
): Promise<void> {
	await storage.setItem(SERVERS_KEY, JSON.stringify(serverListSchema.parse({ servers })));
}
