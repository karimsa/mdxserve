import type { ServerInfo } from "@mdxserve/shared/server-info";
import {
	createContext,
	use,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type { Probe } from "./connection";
import { normaliseOrigin } from "./origin";
import {
	addServer,
	loadServers,
	recordReached as recordReachedIn,
	removeServer,
	renameServer,
	saveServers,
	type KnownServer,
} from "./store";
import type { KeyValueStorage } from "./storage";

export type AddResult =
	| { kind: "added"; server: KnownServer }
	/** The address reached a server already in the list; it was added to that server. */
	| { kind: "merged"; server: KnownServer }
	| { kind: "error"; message: string };

interface ServersApi {
	/** False until the stored list has been read. */
	loaded: boolean;
	servers: KnownServer[];
	/** Why the stored list could not be read, or the last save failed. */
	problem: string | undefined;
	probe: Probe;
	/** Ask what the typed address is, and add it (C1, C2, C5). */
	addByAddress(input: string): Promise<AddResult>;
	rename(id: string, label: string): void;
	remove(id: string): void;
	recordReached(info: ServerInfo, origin: string): void;
}

const ServersContext = createContext<ServersApi | null>(null);

export function useServers(): ServersApi {
	const api = use(ServersContext);
	if (api === null) throw new Error("useServers needs a ServersProvider");
	return api;
}

/**
 * The reader's servers, read from `storage` once and written back after every change. Writes
 * run one at a time and each writes the latest list, so a quick second change cannot be lost
 * behind a slower first one. A failed write keeps the change on screen and says it is not
 * saved; the next change tries again.
 */
export function ServersProvider({
	storage,
	probe,
	children,
}: {
	storage: KeyValueStorage;
	probe: Probe;
	children: ReactNode;
}) {
	const [servers, setServers] = useState<KnownServer[]>([]);
	const [loaded, setLoaded] = useState(false);
	const [problem, setProblem] = useState<string | undefined>();
	const latest = useRef<KnownServer[]>([]);
	const writing = useRef<Promise<void>>(Promise.resolve());

	useEffect(() => {
		let cancelled = false;
		void loadServers(storage)
			.catch((error: unknown) => ({
				kind: "corrupt" as const,
				servers: [],
				message: `The saved servers could not be read: ${String(error)}`,
			}))
			.then((result) => {
				if (cancelled) return;
				latest.current = result.servers;
				setServers(result.servers);
				setProblem(result.kind === "corrupt" ? result.message : undefined);
				setLoaded(true);
			});
		return () => {
			cancelled = true;
		};
	}, [storage]);

	const change = useCallback(
		(next: (current: KnownServer[]) => KnownServer[]) => {
			latest.current = next(latest.current);
			setServers(latest.current);
			writing.current = writing.current.then(() =>
				saveServers(storage, latest.current).then(
					() => setProblem(undefined),
					(error: unknown) =>
						setProblem(`The server list could not be saved on this device: ${String(error)}`),
				),
			);
		},
		[storage],
	);

	const addByAddress = useCallback(
		async (input: string): Promise<AddResult> => {
			const origin = normaliseOrigin(input);
			if (origin.kind !== "ok") return origin;
			const answer = await probe(origin.origin);
			if (answer.kind !== "ok") {
				return {
					kind: "error",
					message: `No mdxserve server answered at ${origin.origin}: ${answer.cause}`,
				};
			}
			const known = latest.current.some((server) => server.id === answer.info.id);
			change((current) =>
				addServer(current, answer.info, [origin.origin, ...answer.info.tailnetUrls], new Date()),
			);
			const server = latest.current.find((candidate) => candidate.id === answer.info.id);
			if (!server) return { kind: "error", message: "The server was not added." };
			return { kind: known ? "merged" : "added", server };
		},
		[change, probe],
	);

	const api = useMemo<ServersApi>(
		() => ({
			loaded,
			servers,
			problem,
			probe,
			addByAddress,
			rename: (id, label) => change((current) => renameServer(current, id, label)),
			remove: (id) => change((current) => removeServer(current, id)),
			recordReached: (info, origin) =>
				change((current) => recordReachedIn(current, info, origin, new Date())),
		}),
		[loaded, servers, problem, probe, addByAddress, change],
	);

	return <ServersContext value={api}>{children}</ServersContext>;
}
