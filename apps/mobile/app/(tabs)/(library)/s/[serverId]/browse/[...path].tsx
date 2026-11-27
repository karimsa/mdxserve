import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { LISTING_SORT_OPTIONS, sortListingEntries } from "@mdxserve/client/listing-sort";
import { Heading, Text } from "@mdxserve/ui/primitives/Text";
import { FolderEntryRow } from "../../../../../../src/library/FolderEntryRow";
import { useListingSort } from "../../../../../../src/library/ListingSortProvider";
import { AnimatedList, AnimatedRow } from "../../../../../../src/library/ListMotion";
import { ServerName } from "../../../../../../src/servers/ServerName";
import {
	baseName,
	childPath,
	pathFromSegments,
	pathSegments,
} from "../../../../../../src/library/paths";
import { useServerQueryOptions } from "../../../../../../src/servers/server-query";
import { useServers } from "../../../../../../src/servers/ServersProvider";
import { displayName, type KnownServer } from "../../../../../../src/servers/store";
import { usePullToRefresh } from "../../../../../../src/pull-to-refresh";
import { useSideInsets } from "../../../../../../src/side-insets";

/** One folder on one server, from `getFolderListing`: its folders, documents and other files (R2). */
export default function Folder() {
	const { serverId, path } = useLocalSearchParams<{ serverId: string; path: string[] }>();
	const dir = pathFromSegments(path);
	const { servers } = useServers();
	const server = servers.find((candidate) => candidate.id === serverId);
	const sideInsets = useSideInsets();
	if (!server) {
		return (
			<View style={[styles.screen, sideInsets]}>
				<Stack.Screen options={{ title: "Folder" }} />
				<Text tone="muted">This server is no longer in the list.</Text>
			</View>
		);
	}
	return <FolderListing server={server} dir={dir} />;
}

function FolderListing({ server, dir }: { server: KnownServer; dir: string }) {
	const router = useRouter();
	const { sort, setSort, saving, problem } = useListingSort();
	const serverQuery = useServerQueryOptions();
	const sideInsets = useSideInsets();
	const listing = useQuery(
		serverQuery(server, "getFolderListing", { path: dir }, (client, input) =>
			client.getFolderListing.query(input),
		),
	);
	const pull = usePullToRefresh(listing.refetch);
	const entries = listing.data ? sortListingEntries(listing.data.entries, sort) : undefined;
	const name = baseName(dir);
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.screen, sideInsets]}
			refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
			testID="folder-content"
		>
			<Stack.Screen options={{ title: name }} />
			{/* Sort is a native bar item with an icon, so iOS can put it in the vertical bar beside a
			    folded display's content. The server's name ends the header, as plain text. */}
			<Stack.Toolbar placement="right">
				<Stack.Toolbar.Menu icon="arrow.up.arrow.down" accessibilityLabel="Sort" title="Sort by">
					{LISTING_SORT_OPTIONS.map((option) => (
						<Stack.Toolbar.MenuAction
							key={option.value}
							isOn={sort === option.value}
							onPress={() => setSort(option.value)}
						>
							{option.label}
						</Stack.Toolbar.MenuAction>
					))}
				</Stack.Toolbar.Menu>
				<Stack.Toolbar.View hidesSharedBackground={true}>
					<ServerName name={displayName(server)} />
				</Stack.Toolbar.View>
			</Stack.Toolbar>
			<Heading level={2}>{name}</Heading>
			{/* The path, cut at its start when long; the server is named in the header. */}
			<Text size="sm" tone="muted" numberOfLines={1} ellipsizeMode="head" testID="folder-path">
				{dir}
			</Text>
			{problem === undefined ? (
				saving ? (
					<Text size="sm" tone="muted">
						Saving the sort order…
					</Text>
				) : null
			) : (
				<Text size="sm" accessibilityRole="alert">
					{problem}
				</Text>
			)}
			{listing.isPending ? (
				<View style={styles.state}>
					<ActivityIndicator size="small" />
				</View>
			) : null}
			{listing.error ? (
				<Text tone="body" paragraph={true}>
					{listing.error.message}
				</Text>
			) : null}
			{entries?.length === 0 ? (
				<Text tone="muted" paragraph={true}>
					This folder is empty.
				</Text>
			) : null}
			{/* Mounted with the first answer, so opening a folder does not animate; a re-sort, a
			    refresh or a refetch that finds the folder changed does. Keys are the entries' paths. */}
			{entries ? (
				<AnimatedList>
					{entries.map((entry) => (
						<AnimatedRow key={childPath(dir, entry.name)}>
							<FolderEntryRow
								entry={entry}
								onOpen={() =>
									router.push({
										pathname: entry.isDir
											? "/s/[serverId]/browse/[...path]"
											: "/s/[serverId]/doc/[...path]",
										params: { serverId: server.id, path: pathSegments(childPath(dir, entry.name)) },
									})
								}
							/>
						</AnimatedRow>
					))}
				</AnimatedList>
			) : null}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { gap: 4, paddingVertical: 16 },
	state: { paddingVertical: 24 },
});
