import { useQueries } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { SectionList, StyleSheet, View } from "react-native";
import { Heading, Text } from "@mdxserve/ui/primitives/Text";
import { pathSegments } from "../../../src/library/paths";
import { SearchRowView } from "../../../src/search/SearchRowView";
import { searchSections, type SearchHit, type SearchState } from "../../../src/search/sections";
import { useServerQueryOptions } from "../../../src/servers/server-query";
import { useServers } from "../../../src/servers/ServersProvider";
import type { KnownServer } from "../../../src/servers/store";
import { useSideInsets } from "../../../src/side-insets";

/** How long typing has to pause before the servers are asked. */
const TYPING_PAUSE_MS = 250;

/**
 * One query, every server (S1): `searchDocs` runs on each server at once, and the results come
 * back in one section per server, in the server list's order (S2), with a server that could not
 * be searched shown as such in its section (S3). A result opens its document inside this tab,
 * so going back returns to the same results.
 */
export default function Search() {
	const router = useRouter();
	const { loaded, servers } = useServers();
	const serverQuery = useServerQueryOptions();
	const sideInsets = useSideInsets();
	const [typed, setTyped] = useState("");
	const [query, setQuery] = useState("");

	useEffect(() => {
		const timer = setTimeout(() => setQuery(typed.trim()), TYPING_PAUSE_MS);
		return () => clearTimeout(timer);
	}, [typed]);

	const results = useQueries({
		queries: servers.map((server) => ({
			...serverQuery(server, "searchDocs", { query }, (client, input) =>
				client.searchDocs.query(input),
			),
			enabled: query !== "",
		})),
	});
	const states = results.map((result): SearchState => {
		if (result.error) return { kind: "failed", message: result.error.message };
		if (result.data) return { kind: "ok", results: result.data.results };
		return { kind: "loading" };
	});
	const sections = query === "" ? [] : searchSections(servers, states);

	function open(server: KnownServer, hit: SearchHit) {
		router.push({
			pathname: "/search/s/[serverId]/doc/[...path]",
			params: {
				serverId: server.id,
				path: pathSegments(hit.path),
				...(hit.targetId === null ? {} : { node: hit.targetId }),
			},
		});
	}

	return (
		<>
			<Stack.Screen
				options={{
					title: "Search",
					headerSearchBarOptions: {
						placeholder: "Search every server",
						autoCapitalize: "none",
						hideWhenScrolling: false,
						onChangeText: (event) => setTyped(event.nativeEvent.text),
					},
				}}
			/>
			<SectionList
				sections={sections}
				keyExtractor={(row) => row.key}
				contentInsetAdjustmentBehavior="automatic"
				keyboardDismissMode="on-drag"
				keyboardShouldPersistTaps="handled"
				stickySectionHeadersEnabled={false}
				contentContainerStyle={[styles.screen, sideInsets]}
				testID="search-content"
				renderSectionHeader={({ section }) => (
					<View style={styles.sectionHeader}>
						<Heading level={5}>{section.title}</Heading>
					</View>
				)}
				renderItem={({ item, section }) => (
					<SearchRowView row={item} onOpen={(hit) => open(section.server, hit)} />
				)}
				ListEmptyComponent={
					<View style={styles.empty}>
						{loaded && servers.length === 0 ? (
							<>
								<Text weight="semibold">No servers yet</Text>
								<Text tone="muted" paragraph={true}>
									Add a server in the Servers tab to search its documents.
								</Text>
							</>
						) : (
							<>
								<Text weight="semibold">Search every server</Text>
								<Text tone="muted" paragraph={true}>
									Type in the search field; each server answers in its own section.
								</Text>
							</>
						)}
					</View>
				}
			/>
		</>
	);
}

const styles = StyleSheet.create({
	screen: { paddingVertical: 8 },
	sectionHeader: { paddingTop: 16, paddingBottom: 4 },
	empty: { gap: 4, paddingVertical: 24 },
});
