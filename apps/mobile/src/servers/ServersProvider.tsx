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
import { checkCandidate, type ConfirmedCandidate } from "./candidate";
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
	/** True while a change is being written to storage. */
	saving: boolean;
	/** How many times a failed write has put the list back; a form starts again when it grows. */
	revertCount: number;
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
 * behind a slower first one. A failed write puts the list back to what storage last accepted
 * and says why, so the screen never shows a change a restart would lose.
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
	const [pendingWrites, setPendingWrites] = useState(0);
	const [revertCount, setRevertCount] = useState(0);
	const latest = useRef<KnownServer[]>([]);
	/** The list as storage last accepted it. */
	const saved = useRef<KnownServer[]>([]);
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
				saved.current = result.servers;
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
			setPendingWrites((count) => count + 1);
			writing.current = writing.current.then(() => {
				const list = latest.current;
				return saveServers(storage, list)
					.then(
						() => {
							saved.current = list;
							setProblem(undefined);
						},
						(error: unknown) => {
							// A newer change is queued: its write carries this one too, so keep both on
							// screen and let it try. Otherwise go back to what storage holds, so the
							// screen never shows a change a restart would lose.
							if (latest.current === list) {
								latest.current = saved.current;
								setServers(saved.current);
								setRevertCount((count) => count + 1);
							}
							setProblem(`The change was not saved on this device: ${String(error)}`);
						},
					)
					.finally(() => setPendingWrites((count) => count - 1));
			});
		},
		[storage],
	);

	/** Save a confirmed candidate. Every way of adding a server ends here. */
	const addConfirmed = useCallback(
		(check: ConfirmedCandidate): AddResult => {
			const known = latest.current.some((server) => server.id === check.info.id);
			change((current) => addServer(current, check.info, check.answered, new Date()));
			const server = latest.current.find((candidate) => candidate.id === check.info.id);
			if (!server) return { kind: "error", message: "The server was not added." };
			return { kind: known ? "merged" : "added", server };
		},
		[change],
	);

	const addByAddress = useCallback(
		async (input: string): Promise<AddResult> => {
			const origin = normaliseOrigin(input);
			if (origin.kind !== "ok") return origin;
			const check = await checkCandidate(
				{ origins: [{ url: origin.origin, source: "manual" }], expectedId: undefined },
				probe,
			);
			if (check.kind === "confirmed") return addConfirmed(check);
			if (check.kind === "different") {
				return { kind: "error", message: `${origin.origin} answered as a different server.` };
			}
			return {
				kind: "error",
				message: `No mdxserve server answered at ${origin.origin}: ${check.causes[0]?.cause ?? "no answer"}`,
			};
		},
		[addConfirmed, probe],
	);

	const api = useMemo<ServersApi>(
		() => ({
			loaded,
			servers,
			problem,
			saving: pendingWrites > 0,
			revertCount,
			probe,
			addByAddress,
			rename: (id, label) => change((current) => renameServer(current, id, label)),
			remove: (id) => change((current) => removeServer(current, id)),
			recordReached: (info, origin) =>
				change((current) => recordReachedIn(current, info, origin, new Date())),
		}),
		[loaded, servers, problem, pendingWrites, revertCount, probe, addByAddress, change],
	);

	return <ServersContext value={api}>{children}</ServersContext>;
}
