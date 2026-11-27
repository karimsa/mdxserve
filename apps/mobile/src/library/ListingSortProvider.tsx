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
	/** Takes effect at once and is saved on the device; a failed save goes back to the saved order. */
	setSort(next: ListingSortKey): void;
}

const ListingSortContext = createContext<ListingSortApi | null>(null);

export function useListingSort(): ListingSortApi {
	const api = use(ListingSortContext);
	if (api === null) throw new Error("useListingSort needs a ListingSortProvider");
	return api;
}

/**
 * The order folder listings are shown in, the same choice the web client offers, kept on the
 * device under the key the web client keeps it under in the browser.
 */
export function ListingSortProvider({
	storage,
	children,
}: {
	storage: KeyValueStorage;
	children: ReactNode;
}) {
	const [sort, setSortState] = useState<ListingSortKey>(DEFAULT_LISTING_SORT);
	const saved = useRef<ListingSortKey>(DEFAULT_LISTING_SORT);
	const changed = useRef(false);

	useEffect(() => {
		let cancelled = false;
		void storage
			.getItem(LISTING_SORT_STORAGE_KEY)
			.catch(() => null)
			.then((stored) => {
				// A choice made while this was loading wins over the stored one.
				if (cancelled || changed.current || !isListingSortKey(stored)) return;
				saved.current = stored;
				setSortState(stored);
			});
		return () => {
			cancelled = true;
		};
	}, [storage]);

	const api = useMemo<ListingSortApi>(
		() => ({
			sort,
			setSort: (next) => {
				changed.current = true;
				setSortState(next);
				storage.setItem(LISTING_SORT_STORAGE_KEY, next).then(
					() => {
						saved.current = next;
					},
					() => setSortState(saved.current),
				);
			},
		}),
		[sort, storage],
	);

	return <ListingSortContext value={api}>{children}</ListingSortContext>;
}
