import { useQueries } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "@mdxserve/ui/primitives/Text";
import { LibraryRowView } from "../../../src/library/LibraryRowView";
import { pathSegments } from "../../../src/library/paths";
import { libraryRows, type RootsState } from "../../../src/library/rows";
import { useServerQueryOptions } from "../../../src/servers/server-query";
import { useServers } from "../../../src/servers/ServersProvider";
import { useSideInsets } from "../../../src/side-insets";

/**
 * Every server's mounted folders in one list, each labelled with its server (R1). Each server
 * is asked with `listRoots` at the same time; one that cannot be reached is one row saying so,
 * and the rest still load (R5).
 */
export default function Library() {
	const router = useRouter();
	const { loaded, servers } = useServers();
	const serverQuery = useServerQueryOptions();
	const sideInsets = useSideInsets();
	const results = useQueries({
		queries: servers.map((server) =>
			serverQuery(server, "listRoots", {}, (client) => client.listRoots.query()),
		),
	});
	const states = results.map((result): RootsState => {
		// An error first: a refetch that failed keeps the last roots in `data`, and they are stale.
		if (result.error) return { kind: "failed", message: result.error.message };
		if (result.data) return { kind: "ok", roots: result.data.roots };
		return { kind: "loading" };
	});
	const rows = libraryRows(servers, states);
	const refreshing = results.some((result) => result.isRefetching);
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.screen, sideInsets]}
			refreshControl={
				<RefreshControl
					refreshing={refreshing}
					onRefresh={() => {
						for (const result of results) void result.refetch();
					}}
				/>
			}
			testID="library-content"
		>
			<Stack.Screen options={{ title: "Library" }} />
			{/* A native bar item with an icon: iOS puts it in the top bar, or in the vertical bar
			    beside the content when a folded display draws one. */}
			<Stack.Toolbar placement="right">
				<Stack.Toolbar.Button
					icon="square.grid.2x2"
					accessibilityLabel="Gallery"
					onPress={() => router.push("/gallery")}
				/>
			</Stack.Toolbar>
			{loaded && servers.length === 0 ? (
				<View style={styles.empty}>
					<Text weight="semibold">No servers yet</Text>
					<Text tone="muted" paragraph={true}>
						Add a server in the Servers tab, and its folders show here.
					</Text>
				</View>
			) : null}
			{rows.map((row) => (
				<LibraryRowView
					key={row.key}
					row={row}
					onOpen={(server, root) =>
						router.push({
							pathname: "/s/[serverId]/browse/[...path]",
							params: { serverId: server.id, path: pathSegments(root.dir) },
						})
					}
				/>
			))}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { paddingVertical: 16 },
	empty: { gap: 4, paddingVertical: 24 },
});
