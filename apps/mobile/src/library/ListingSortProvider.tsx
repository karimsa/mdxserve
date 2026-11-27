import {
	DEFAULT_LISTING_SORT,
	isListingSortKey,
	LISTING_SORT_STORAGE_KEY,
	type ListingSortKey,
} from "@mdxserve/client/listing-sort";
import { createContext, use, useMemo, type ReactNode } from "react";
import { useStoredChoice } from "../preferences/stored-choice";
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

const parseSort = (stored: string) => (isListingSortKey(stored) ? stored : undefined);
const formatSort = (sort: ListingSortKey) => sort;

/**
 * The order folder listings are shown in, the same choice the web client offers, kept on the
 * device under the key the web client keeps it under in the browser (see `useStoredChoice`
 * for how saving works).
 */
export function ListingSortProvider({
	storage,
	children,
}: {
	storage: KeyValueStorage;
	children: ReactNode;
}) {
	const choice = useStoredChoice({
		storage,
		key: LISTING_SORT_STORAGE_KEY,
		fallback: DEFAULT_LISTING_SORT,
		parse: parseSort,
		format: formatSort,
		describe: "the sort order",
	});
	const api = useMemo<ListingSortApi>(
		() => ({
			sort: choice.value,
			setSort: choice.set,
			saving: choice.saving,
			problem: choice.problem,
		}),
		[choice],
	);
	return <ListingSortContext value={api}>{children}</ListingSortContext>;
}
