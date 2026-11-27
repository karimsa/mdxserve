import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { LISTING_SORT_OPTIONS, sortListingEntries } from "@mdxserve/client/listing-sort";
import { Heading, Text } from "@mdxserve/ui/primitives/Text";
import { FolderEntryRow } from "../../../../../../src/library/FolderEntryRow";
import { useListingSort } from "../../../../../../src/library/ListingSortProvider";
import {
	baseName,
	childPath,
	pathFromSegments,
	pathSegments,
} from "../../../../../../src/library/paths";
import { useServerQueryOptions } from "../../../../../../src/servers/server-query";
import { useServers } from "../../../../../../src/servers/ServersProvider";
import { displayName, type KnownServer } from "../../../../../../src/servers/store";
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
	const { sort, setSort } = useListingSort();
	const serverQuery = useServerQueryOptions();
	const sideInsets = useSideInsets();
	const listing = useQuery(
		serverQuery(server, "getFolderListing", { path: dir }, (client, input) =>
			client.getFolderListing.query(input),
		),
	);
	const entries = listing.data ? sortListingEntries(listing.data.entries, sort) : undefined;
	const name = baseName(dir);
	return (
		<ScrollView
			contentInsetAdjustmentBehavior="automatic"
			contentContainerStyle={[styles.screen, sideInsets]}
			refreshControl={
				<RefreshControl
					refreshing={listing.isRefetching}
					onRefresh={() => void listing.refetch()}
				/>
			}
			testID="folder-content"
		>
			<Stack.Screen options={{ title: name }} />
			{/* Native bar items with icons, so iOS can put them in the vertical bar beside a folded
			    display's content, as on the Library. */}
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
				<Stack.Toolbar.Button
					icon="gearshape"
					accessibilityLabel="Settings"
					onPress={() => router.push("/settings")}
				/>
			</Stack.Toolbar>
			<Heading level={2}>{name}</Heading>
			<Text size="sm" tone="muted">
				{`${displayName(server)} · ${dir}`}
			</Text>
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
			{entries?.map((entry) => (
				<FolderEntryRow
					key={entry.name}
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
			))}
		</ScrollView>
	);
}

const styles = StyleSheet.create({
	screen: { gap: 4, paddingVertical: 16 },
	state: { paddingVertical: 24 },
});
