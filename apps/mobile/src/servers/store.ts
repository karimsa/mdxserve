import { serverInfoSchema, type ServerInfo } from "@mdxserve/shared/server-info";
import { z } from "zod";
import type { KeyValueStorage } from "./storage";

/**
 * The one key the server list is stored under.
 * @internal Exported for its tests.
 */
export const SERVERS_KEY = "mdxserve:servers:v1";

/**
 * Where an address came from: typed (`manual`), scanned (`qr`), a tailnet peer, a tailnet URL the
 * server itself reported in `tailnetUrls` (`reported`; stored as `manual` before there was a
 * word for it), or a local network advert.
 */
const addressSourceSchema = z.enum([
	"manual",
	"qr",
	"tailnet-peer",
	"reported",
	"bonjour-lan",
	"bonjour-tailnet",
]);

export type AddressSource = z.infer<typeof addressSourceSchema>;

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

/** An address and where it came from, before it is saved. */
export interface SourcedOrigin {
	url: string;
	source: AddressSource;
}

/** The `https://` origins a server reported (`tailnetUrls`), to save as `reported`. */
function reportedOrigins(info: ServerInfo): SourcedOrigin[] {
	return info.tailnetUrls
		.filter((url) => url.startsWith("https://") && URL.canParse(url))
		.map((url) => ({ url: new URL(url).origin, source: "reported" }));
}

/**
 * The list with `origins` appended to the server `id` (each address once), and taken off every
 * other server: an address belongs to one server only.
 */
function withAddresses(
	servers: readonly KnownServer[],
	server: KnownServer,
	origins: readonly SourcedOrigin[],
): KnownServer[] {
	const added: ServerAddress[] = [];
	for (const origin of origins) {
		const known = [...server.addresses, ...added].some((address) => address.url === origin.url);
		if (!known) added.push({ url: origin.url, source: origin.source });
	}
	const urls = added.map((address) => address.url);
	const updated = { ...server, addresses: [...server.addresses, ...added] };
	const exists = servers.some((candidate) => candidate.id === server.id);
	const list = servers.map((candidate) =>
		candidate.id === server.id
			? updated
			: {
					...candidate,
					addresses: candidate.addresses.filter((address) => !urls.includes(address.url)),
				},
	);
	return exists ? list : [...list, updated];
}

/**
 * Add a server the reader confirmed: a new one, or the addresses appended to the server that
 * already has this id (one server however many addresses reach it). `answered` are the origins
 * that answered `getServerInfo` with `info.id`, with where each came from; they are marked as
 * just reached. Then the `https://` tailnet URLs of the answer are appended as `reported`.
 * Origins that did not answer are never saved.
 */
export function addServer(
	servers: readonly KnownServer[],
	info: ServerInfo,
	answered: readonly SourcedOrigin[],
	now: Date,
): KnownServer[] {
	const existing = servers.find((server) => server.id === info.id);
	const base: KnownServer = {
		id: info.id,
		name: info.name,
		...(existing?.label === undefined ? {} : { label: existing.label }),
		version: info.version,
		permissions: info.permissions,
		treeSchemaVersion: info.treeSchemaVersion,
		addedAt: existing?.addedAt ?? now.toISOString(),
		addresses: existing?.addresses ?? [],
	};
	const reached = new Set(answered.map((origin) => origin.url));
	return withAddresses(servers, base, [...answered, ...reportedOrigins(info)]).map((server) =>
		server.id !== info.id
			? server
			: {
					...server,
					addresses: server.addresses.map((address) =>
						reached.has(address.url) ? { ...address, lastOkAt: now.toISOString() } : address,
					),
				},
	);
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

/**
 * Note that `url` answered with the server's id, and refresh what the server said about itself.
 * An answer over `https://` also adds the server's new `https://` tailnet URLs as `reported`;
 * one over plain `http://` adds nothing, since anyone on the path could have written it.
 */
export function recordReached(
	servers: readonly KnownServer[],
	info: ServerInfo,
	url: string,
	now: Date,
): KnownServer[] {
	const server = servers.find((candidate) => candidate.id === info.id);
	if (server === undefined) return [...servers];
	const refreshed: KnownServer = {
		...server,
		name: info.name,
		version: info.version,
		permissions: info.permissions,
		treeSchemaVersion: info.treeSchemaVersion,
		addresses: server.addresses.map((address) =>
			address.url === url ? { ...address, lastOkAt: now.toISOString() } : address,
		),
	};
	const reported = url.startsWith("https://") ? reportedOrigins(info) : [];
	return withAddresses(servers, refreshed, reported);
}

/**
 * The order to try addresses in: HTTPS before HTTP, then the most recently reached, then the
 * rest in the order given.
 */
export function byPriority<Address extends { url: string; lastOkAt?: string }>(
	addresses: readonly Address[],
): Address[] {
	const secure = (address: Address) => (address.url.startsWith("https://") ? 0 : 1);
	return [...addresses].sort(
		(left, right) =>
			secure(left) - secure(right) || (right.lastOkAt ?? "").localeCompare(left.lastOkAt ?? ""),
	);
}

/** The order to try a server's addresses in (`byPriority`). */
export function orderedAddresses(server: KnownServer): ServerAddress[] {
	return byPriority(server.addresses);
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
