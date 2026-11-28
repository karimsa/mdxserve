import { useQueries } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { SectionList, StyleSheet, TextInput, View } from "react-native";
import { Heading, Text } from "@mdxserve/ui/primitives/Text";
import { pathSegments } from "../../../src/library/paths";
import { SearchRowView } from "../../../src/search/SearchRowView";
import { searchSections, type SearchHit, type SearchState } from "../../../src/search/sections";
import { useServerQueryOptions } from "../../../src/servers/server-query";
import { useServers } from "../../../src/servers/ServersProvider";
import { displayName, type KnownServer } from "../../../src/servers/store";
import { deviceStorage } from "../../../src/servers/device-storage";
import { useSearchServerFilter } from "../../../src/search/server-filter";
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
	const filter = useSearchServerFilter(deviceStorage, servers);
	const serverQuery = useServerQueryOptions();
	const sideInsets = useSideInsets();
	const [typed, setTyped] = useState("");
	const [query, setQuery] = useState("");

	useEffect(() => {
		// An emptied field clears the results at once (see `clear`); only typing waits.
		if (typed.trim() === "") return;
		const timer = setTimeout(() => setQuery(typed.trim()), TYPING_PAUSE_MS);
		return () => clearTimeout(timer);
	}, [typed]);

	/** Emptying the field (its clear control, or deleting the text) empties the results at once. */
	function clear() {
		setTyped("");
		setQuery("");
	}

	function changeText(text: string) {
		if (text.trim() === "") clear();
		else setTyped(text);
	}

	const results = useQueries({
		queries: filter.included.map((server) => ({
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
	const sections = query === "" ? [] : searchSections(filter.included, states);

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
			<Stack.Screen options={{ title: "Search" }} />
			{/* A native bar item with an icon, so iOS can move it into the vertical bar beside a folded
			    display. The bare filter glyph, with no circle around it; the menu's checks and the
			    item's label say when some server is left out. */}
			<Stack.Toolbar placement="right">
				<Stack.Toolbar.Menu
					icon="line.3.horizontal.decrease"
					accessibilityLabel={filter.active ? "Servers to search, filtered" : "Servers to search"}
					title="Search these servers"
				>
					{servers.map((server) => (
						<Stack.Toolbar.MenuAction
							key={server.id}
							isOn={filter.isIncluded(server.id)}
							onPress={() => filter.toggle(server.id)}
						>
							{displayName(server)}
						</Stack.Toolbar.MenuAction>
					))}
				</Stack.Toolbar.Menu>
			</Stack.Toolbar>
			<SectionList
				sections={sections}
				keyExtractor={(row) => row.key}
				contentInsetAdjustmentBehavior="automatic"
				keyboardDismissMode="on-drag"
				keyboardShouldPersistTaps="handled"
				stickySectionHeadersEnabled={false}
				contentContainerStyle={[styles.screen, sideInsets]}
				testID="search-content"
				ListHeaderComponent={
					// An ordinary field at the top of the results, not the navigation bar's search
					// controller: that one always shows a Cancel control (a large round X on iOS 26 and
					// later) that react-native-screens cannot hide. Its own clear control empties the
					// query; the keyboard's Search key, a tap outside it and a scroll dismiss the keyboard.
					<View style={styles.field}>
						<TextInput
							value={typed}
							onChangeText={changeText}
							onSubmitEditing={(event) => setQuery(event.nativeEvent.text.trim())}
							placeholder="Search every server"
							accessibilityLabel="Search every server"
							autoCapitalize="none"
							autoCorrect={false}
							clearButtonMode="while-editing"
							enterKeyHint="search"
							returnKeyType="search"
							submitBehavior="blurAndSubmit"
							inputMode="search"
							testID="search-field"
							className="rounded-md border border-border-default bg-surface-card px-3 py-2 font-sans text-text-body"
						/>
						{/* How saving the server filter went, shown whatever the results are. */}
						{filter.problem === undefined ? (
							filter.saving ? (
								<Text size="sm" tone="muted">
									Saving the server filter…
								</Text>
							) : null
						) : (
							<Text size="sm" accessibilityRole="alert">
								{filter.problem}
							</Text>
						)}
					</View>
				}
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
						) : filter.included.length === 0 ? (
							<>
								<Text weight="semibold">No servers selected</Text>
								<Text tone="muted" paragraph={true}>
									Choose the servers to search with the filter in the header.
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
	field: { gap: 4 },
	sectionHeader: { paddingTop: 16, paddingBottom: 4 },
	empty: { gap: 4, paddingVertical: 24 },
});
