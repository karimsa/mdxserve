import { useCallback, useState } from "react";

/**
 * A pull to refresh whose spinner shows only while the reader's own pull runs. A background
 * refetch (a live update, the app returning to the foreground, a saved tick) must not set
 * `refreshing`: React Native's iOS refresh control then begins refreshing programmatically, which
 * moves the scroll view's offset to show the spinner, and the reader loses their place.
 */
export function usePullToRefresh(refetch: () => Promise<unknown>) {
	const [refreshing, setRefreshing] = useState(false);
	const onRefresh = useCallback(() => {
		setRefreshing(true);
		void refetch().finally(() => setRefreshing(false));
	}, [refetch]);
	return { refreshing, onRefresh };
}
