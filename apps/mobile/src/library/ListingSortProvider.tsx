import {
	DEFAULT_LISTING_SORT,
	isListingSortKey,
	LISTING_SORT_STORAGE_KEY,
	type ListingSortKey,
} from "@mdxserve/client/listing-sort";
import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { KeyValueStorage } from "../servers/storage";

interface ListingSortApi {
	sort: ListingSortKey;
	/** Takes effect at once and is saved on the device. */
	setSort(next: ListingSortKey): void;
	/** True while a choice is being written. */
	saving: boolean;
	/** Why the last choice could not be saved, until a later one is. */
	problem: string | undefined;
}

const ListingSortContext = createContext<ListingSortApi | null>(null);

export function useListingSort(): ListingSortApi {
	const api = use(ListingSortContext);
	if (api === null) throw new Error("useListingSort needs a ListingSortProvider");
	return api;
}

/**
 * The order folder listings are shown in, the same choice the web client offers, kept on the
 * device under the key the web client keeps it under in the browser. Writes run one at a time
 * and each writes the latest choice. A failed write puts the order back to the saved one,
 * unless a newer choice is already waiting to be written, and says why.
 */
export function ListingSortProvider({
	storage,
	children,
}: {
	storage: KeyValueStorage;
	children: ReactNode;
}) {
	const [sort, setSortState] = useState<ListingSortKey>(DEFAULT_LISTING_SORT);
	const [pendingWrites, setPendingWrites] = useState(0);
	const [problem, setProblem] = useState<string | undefined>();
	const saved = useRef<ListingSortKey>(DEFAULT_LISTING_SORT);
	const latest = useRef<ListingSortKey>(DEFAULT_LISTING_SORT);
	const changed = useRef(false);
	const writing = useRef<Promise<void>>(Promise.resolve());

	useEffect(() => {
		let cancelled = false;
		void storage
			.getItem(LISTING_SORT_STORAGE_KEY)
			.catch(() => null)
			.then((stored) => {
				// A choice made while this was loading wins over the stored one.
				if (cancelled || changed.current || !isListingSortKey(stored)) return;
				saved.current = stored;
				latest.current = stored;
				setSortState(stored);
			});
		return () => {
			cancelled = true;
		};
	}, [storage]);

	const api = useMemo<ListingSortApi>(
		() => ({
			sort,
			saving: pendingWrites > 0,
			problem,
			setSort: (next) => {
				changed.current = true;
				latest.current = next;
				setSortState(next);
				setPendingWrites((count) => count + 1);
				writing.current = writing.current.then(() => {
					const value = latest.current;
					return storage
						.setItem(LISTING_SORT_STORAGE_KEY, value)
						.then(
							() => {
								saved.current = value;
								setProblem(undefined);
							},
							(error: unknown) => {
								if (latest.current === value) {
									latest.current = saved.current;
									setSortState(saved.current);
								}
								setProblem(`The sort order was not saved on this device: ${String(error)}`);
							},
						)
						.finally(() => setPendingWrites((count) => count - 1));
				});
			},
		}),
		[sort, pendingWrites, problem, storage],
	);

	return <ListingSortContext value={api}>{children}</ListingSortContext>;
}
